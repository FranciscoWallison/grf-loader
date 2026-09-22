/**
 * What getFile() keeps in memory.
 */
import {bufferPool} from '../src/buffer-pool';
import {openBuiltGrf} from './helpers/open-grf';

const entry = (name: string, size: number) => ({name, content: Buffer.alloc(size, name.charCodeAt(5))});
const files = [entry('data\\a.bin', 1000), entry('data\\b.bin', 1000), entry('data\\c.bin', 1000)];

describe('the decoded-file cache', () => {
  it('hands the same data back on a second read', async () => {
    const grf = await openBuiltGrf(files);
    const first = await grf.getFile('data\\a.bin');
    const second = await grf.getFile('data\\a.bin');
    expect(second.data).toBe(first.data);

    grf.clearCache();
    const third = await grf.getFile('data\\a.bin');
    expect(third.data).not.toBe(first.data);
    expect(Buffer.from(third.data!)).toEqual(Buffer.from(first.data!));
  });

  it('cacheMaxFiles: 0 keeps nothing', async () => {
    const grf = await openBuiltGrf(files, {cacheMaxFiles: 0});
    const first = await grf.getFile('data\\a.bin');
    const second = await grf.getFile('data\\a.bin');
    expect(second.data).not.toBe(first.data);
    expect(Buffer.from(second.data!)).toEqual(Buffer.from(first.data!));
  });

  it('evicts the least recently used file once it is full', async () => {
    const grf = await openBuiltGrf(files, {cacheMaxFiles: 2});
    const a = await grf.getFile('data\\a.bin');
    await grf.getFile('data\\b.bin');
    await grf.getFile('data\\a.bin'); // a is now the most recently used, b the oldest
    await grf.getFile('data\\c.bin'); // evicts b

    expect((await grf.getFile('data\\a.bin')).data).toBe(a.data);
    const b = await grf.getFile('data\\b.bin'); // b was gone: read again, and c is evicted for it
    expect((await grf.getFile('data\\b.bin')).data).toBe(b.data);
    await grf.getFile('data\\c.bin'); // now a is the oldest
    expect((await grf.getFile('data\\a.bin')).data).not.toBe(a.data);
  });

  it('cacheMaxBytes evicts by size, and a file larger than it is never cached', async () => {
    const grf = await openBuiltGrf(files, {cacheMaxBytes: 2500});
    const a = await grf.getFile('data\\a.bin');
    const b = await grf.getFile('data\\b.bin');
    expect((await grf.getFile('data\\a.bin')).data).toBe(a.data); // a is now the most recent
    await grf.getFile('data\\c.bin'); // 3 x 1000 bytes do not fit: b, the oldest, goes
    expect((await grf.getFile('data\\a.bin')).data).toBe(a.data);
    expect((await grf.getFile('data\\b.bin')).data).not.toBe(b.data);

    const small = await openBuiltGrf(files, {cacheMaxBytes: 999});
    const first = await small.getFile('data\\a.bin');
    expect((await small.getFile('data\\a.bin')).data).not.toBe(first.data);
  });
});

describe('the shared buffer pool', () => {
  it('is not used by reads any more', async () => {
    const grf = await openBuiltGrf(files);
    for (const {name} of files) await grf.getFile(name);

    // Nothing ever released what it took, so every buffer stayed marked in use for good.
    expect(bufferPool.stats().every(pool => pool.total === 0)).toBe(true);
  });
});
