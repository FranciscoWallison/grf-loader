/**
 * Lookups beyond the exact name: normalized paths, extensions, find(), statistics. load() leaves their
 * indexes to the first call that needs them; these tests pin down that they answer as when load() built
 * them.
 */
import {mkdtempSync, openSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {GrfNode} from '../src/grf-node';
import {buildGrf, BuilderEntry} from './helpers/grf-builder';
import {openBuiltGrf} from './helpers/open-grf';

const entries: BuilderEntry[] = [
  {name: 'data\\Sprite\\A.spr', content: 'upper'},
  {name: 'data\\sprite\\a.spr', content: 'lower'},
  {name: 'data\\texture\\b.BMP', content: 'bitmap'},
  {name: 'data\\c.act', content: 'act'},
  {name: 'data\\noext', content: 'none'},
];

describe('normalized paths', () => {
  it('finds a name in any case and with either slash', async () => {
    const grf = await openBuiltGrf(entries);
    expect(grf.resolvePath('DATA/TEXTURE/B.bmp')).toEqual({status: 'found', matchedPath: 'data\\texture\\b.BMP'});
    expect(grf.hasFile('data/c.ACT')).toBe(true);
    expect(grf.getEntry('Data\\NoExt')?.realSize).toBe(4);
    const {data} = await grf.getFile('data/texture/b.bmp');
    expect(Buffer.from(data!).toString()).toBe('bitmap');
  });

  it('reports names that differ only in case as ambiguous, and counts them', async () => {
    const grf = await openBuiltGrf(entries);
    expect(grf.resolvePath('data\\Sprite\\A.spr')).toEqual({status: 'found', matchedPath: 'data\\Sprite\\A.spr'});
    expect(grf.resolvePath('data/sprite/A.SPR')).toEqual({
      status: 'ambiguous',
      candidates: ['data\\Sprite\\A.spr', 'data\\sprite\\a.spr'],
    });
    expect(grf.getStats().collisionCount).toBe(1);
  });

  it('a miss is not_found', async () => {
    const grf = await openBuiltGrf(entries);
    expect(grf.resolvePath('data/missing.spr')).toEqual({status: 'not_found'});
  });
});

describe('extensions and find()', () => {
  it('indexes extensions in lower case', async () => {
    const grf = await openBuiltGrf(entries);
    expect(grf.listExtensions()).toEqual(['act', 'bmp', 'spr']);
    expect(grf.getFilesByExtension('.BMP')).toEqual(['data\\texture\\b.BMP']);
    expect(grf.getStats().extensionStats).toEqual(new Map([['spr', 2], ['bmp', 1], ['act', 1]]));
  });

  it('find() filters by extension, substring, ending and regex', async () => {
    const grf = await openBuiltGrf(entries);
    expect(grf.find({ext: 'SPR'})).toEqual(['data\\Sprite\\A.spr', 'data\\sprite\\a.spr']);
    expect(grf.find({ext: 'spr', limit: 1})).toEqual(['data\\Sprite\\A.spr']);
    expect(grf.find({contains: 'TEXTURE/'})).toEqual(['data\\texture\\b.BMP']);
    expect(grf.find({endsWith: '.ACT'})).toEqual(['data\\c.act']);
    expect(grf.find({regex: /noext$/})).toEqual(['data\\noext']);
    expect(grf.find({ext: 'spr', contains: 'sprite\\a'})).toEqual(['data\\Sprite\\A.spr', 'data\\sprite\\a.spr']);
  });
});

describe('statistics', () => {
  it('asking before load() does not keep the indexes empty after it', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'grf-loader-test-')), 'test.grf');
    writeFileSync(file, buildGrf(entries));
    const grf = new GrfNode(openSync(file, 'r'));
    expect(grf.getStats().fileCount).toBe(0);
    expect(grf.resolvePath('data/c.act').status).toBe('not_found');

    await grf.load();
    expect(grf.getStats().collisionCount).toBe(1);
    expect(grf.resolvePath('data/c.act').status).toBe('found');
    expect(grf.listExtensions()).toEqual(['act', 'bmp', 'spr']);
  });

  it('counts the names that decode badly, and reloadWithEncoding() starts over', async () => {
    const korean = [
      {name: 'data\\texture\\유저인터페이스\\a.bmp', content: 'a'},
      {name: 'data\\texture\\유저인터페이스\\b.bmp', content: 'b'},
      {name: 'data\\ascii.txt', content: 'c'},
    ];
    const grf = await openBuiltGrf(korean, {filenameEncoding: 'utf-8'});
    expect(grf.getStats().badNameCount).toBe(2);
    expect(grf.hasFile(korean[0].name)).toBe(false);

    await grf.reloadWithEncoding('cp949');
    expect(grf.getStats()).toMatchObject({fileCount: 3, badNameCount: 0, detectedEncoding: 'cp949'});
    expect(grf.resolvePath('DATA/TEXTURE/유저인터페이스/A.BMP')).toEqual({status: 'found', matchedPath: korean[0].name});
    expect(grf.getFilesByExtension('bmp')).toEqual([korean[0].name, korean[1].name]);
  });
});
