/**
 * What getFile() hands back, byte for byte.
 */
import {openBuiltGrf} from './helpers/open-grf';

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
});
