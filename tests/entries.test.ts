/**
 * What getFile() hands back, byte for byte.
 */
import {mkdtempSync, openSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {GrfNode} from '../src/grf-node';
import {buildGrf} from './helpers/grf-builder';
import {openBuiltGrf} from './helpers/open-grf';

const HEADER_SIZE = 46;

describe('stored entries (no compression)', () => {
  it('returns exactly realSize bytes, not the alignment padding after them', async () => {
    // DES aligns an entry to 8 bytes, so a stored entry can span more bytes than it holds. In the bRO
    // data.grf, 5 of the 16 stored entries do -- a .wav of 1,410 bytes came back as 1,416.
    const content = Buffer.from('a stored entry of 30 bytes!!!!');
    const grf = await openBuiltGrf([{name: 'data\\stored.txt', content, stored: true, padding: 2}]);

    const {data, error} = await grf.getFile('data\\stored.txt');
    expect(error).toBe(null);
    expect(Buffer.from(data!)).toEqual(content);
  });

  it('a stored entry without padding is returned whole', async () => {
    const content = Buffer.from('exactly aligned: 32 bytes long!!');
    const grf = await openBuiltGrf([{name: 'data\\aligned.txt', content, stored: true}]);
    const {data} = await grf.getFile('data\\aligned.txt');
    expect(Buffer.from(data!)).toEqual(content);
  });
});

describe('compressed entries', () => {
  it('ignores bytes after the compressed stream', async () => {
    const content = Buffer.from('compressed payload '.repeat(20));
    const grf = await openBuiltGrf([{name: 'data\\packed.txt', content, padding: 5}]);
    const {data, error} = await grf.getFile('data\\packed.txt');
    expect(error).toBe(null);
    expect(Buffer.from(data!)).toEqual(content);
  });

  it('inflates entries of every size byte for byte, on and off the main thread', async () => {
    // GrfNode inflates up to 64 KiB of output on the main thread and larger entries in the thread pool.
    const sizes = [1000, 64 * 1024, 64 * 1024 + 1, 300 * 1024];
    const entries = sizes.map(size => ({name: `data\\${size}.bin`, content: pseudoRandom(size)}));
    const grf = await openBuiltGrf(entries);

    for (const {name, content} of entries) {
      const {data, error} = await grf.getFile(name);
      expect(error).toBe(null);
      expect(Buffer.compare(Buffer.from(data!), content)).toBe(0);
    }
  });

  it('a corrupt stream is an error, on and off the main thread', async () => {
    for (const size of [1000, 300 * 1024]) {
      const archive = buildGrf([{name: 'data\\broken.bin', content: pseudoRandom(size)}]);
      archive[HEADER_SIZE] = 0; // the zlib header of the only entry, right after the GRF header
      const file = join(mkdtempSync(join(tmpdir(), 'grf-loader-test-')), 'broken.grf');
      writeFileSync(file, archive);
      const grf = new GrfNode(openSync(file, 'r'));
      await grf.load();

      const {data, error} = await grf.getFile('data\\broken.bin');
      expect(data).toBe(null);
      expect(error).toMatch(/header/);
    }
  });
});

/** Deterministic bytes that still compress: a byte from a small LCG, every other byte a counter. */
function pseudoRandom(size: number): Buffer {
  const out = Buffer.alloc(size);
  let state = size;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    out[i] = i % 2 ? (state >>> 24) & 0x0f : i & 0xff;
  }
  return out;
}
