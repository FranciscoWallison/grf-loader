/**
 * Filename encoding: detection, and decoding Korean names in full.
 */
import {openBuiltGrf} from './helpers/open-grf';

const file = (name: string) => ({name, content: `payload of ${name} `.repeat(6)});

describe('encoding auto-detection', () => {
  it('finds CP949 when the table starts with hundreds of ASCII names', async () => {
    // Detection sampled the first 200 names. All ASCII, they carried no evidence, the answer was
    // 'utf-8', and every Korean name after them decoded to U+FFFD -- unreachable by its real name.
    const entries = [];
    for (let i = 0; i < 250; i++) entries.push(file(`data\\map${i}.gat`));
    entries.push(file('data\\texture\\유저인터페이스\\basic.bmp'));

    const grf = await openBuiltGrf(entries);
    expect(grf.getDetectedEncoding()).toBe('cp949');
    expect(grf.hasFile('data\\texture\\유저인터페이스\\basic.bmp')).toBe(true);
    expect(grf.getStats().badNameCount).toBe(0);
  });

  it('an archive of ASCII names only is utf-8', async () => {
    const grf = await openBuiltGrf([file('data\\a.gat'), file('data\\b.gat')]);
    expect(grf.getDetectedEncoding()).toBe('utf-8');
  });
});

describe('Korean names', () => {
  it('decodes syllables outside EUC-KR (CP949 extension)', async () => {
    // 똠 is 0x8C 0x63 and 웤 is 0x9F 0x70: CP949 only. A plain EUC-KR decoder turns them into a C1 control
    // plus a Latin letter.
    const names = ['data\\sprite\\아이템\\똠양꿍.spr', 'data\\texture\\유저인터페이스\\cardbmp\\웤웤카드.bmp'];
    const grf = await openBuiltGrf(names.map(file));
    expect(grf.listFiles().sort()).toEqual([...names].sort());
  });
});
