// src/grf-node.ts
import { fstatSync, read as readCallback } from 'fs';
import { promisify } from 'util';
import { inflate as inflateCallback, inflateSync } from 'zlib';
import iconv from 'iconv-lite';
import { GrfBase, GrfOptions } from './grf-base';
import { setKoreanCodec } from './decoder';

// A static import, so both the CommonJS and the ES module builds load iconv-lite (see decoder.ts).
// Buffer.from over the same memory: iconv-lite wants a Buffer, and a copy per name would be waste.
setKoreanCodec({
  decode: (bytes, encoding) => iconv.decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), encoding),
  encode: (text, encoding) => iconv.encode(text, encoding),
});

const readAsync = promisify(readCallback);
const inflateAsync = promisify(inflateCallback);

/**
 * Up to this output size an entry inflates on the main thread: a trip to the thread pool costs more than
 * the work. Larger ones inflate in the pool, off the event loop -- the 20 MiB map of the bRO data.grf
 * held it for ~180 ms with pako.
 */
const SYNC_INFLATE_MAX_BYTES = 64 * 1024;

/** Options for GrfNode */
export interface GrfNodeOptions extends GrfOptions {
  /**
   * @deprecated Ignored. Reads always allocate their own buffer; see getStreamBuffer.
   */
  useBufferPool?: boolean;
}

export class GrfNode extends GrfBase<number> {
  constructor(fd: number, options?: GrfNodeOptions) {
    super(fd, options);

    // Na nossa API, apenas FDs para arquivos regulares são válidos.
    // fstatSync lança erro se o descritor não existir ou não for arquivo.
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) {
        throw new Error('GRFNode: file descriptor must point to a regular file');
      }
    } catch {
      // Converte em mensagem clara para o usuário
      throw new Error('GRFNode: invalid file descriptor');
    }
  }

  /**
   * Reads always allocate. The shared pool (still exported, deprecated) handed out buffers that nothing
   * ever gave back, so after 80 reads every read allocated anyway -- and a buffer that did come back would
   * be reused under the caller, because a stored entry is returned as a view into the buffer it was read
   * into.
   */
  public async getStreamBuffer(
    fd: number,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    const buffer = Buffer.allocUnsafe(length);

    const { bytesRead } = await readAsync(fd, buffer, 0, length, offset);

    if (bytesRead !== length) {
      // ERRO TYPE: GRFNode: unexpected EOF
      throw new Error('Not a GRF file (invalid signature)');
    }

    return buffer;
  }

  /** Node's native zlib: 3-6x faster than pako on the bRO data.grf (benchmark/real-grf-profile.mjs). */
  protected async inflate(data: Uint8Array, realSize: number): Promise<Uint8Array> {
    // One output chunk of the known size. zlib's default 16 KiB chunks cost a copy each and, in the pool,
    // a round trip each. The +1 keeps a full chunk from making zlib allocate another to look for more.
    const options = { chunkSize: Math.max(realSize + 1, 64) };
    const out = realSize <= SYNC_INFLATE_MAX_BYTES
      ? inflateSync(data, options)
      : await inflateAsync(data, options);
    // A plain Uint8Array over the same memory, as pako returned: Buffer's slice() does not copy.
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
}
