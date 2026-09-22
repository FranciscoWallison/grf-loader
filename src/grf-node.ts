// src/grf-node.ts
import { fstatSync, read as readCallback } from 'fs';
import { promisify } from 'util';
import iconv from 'iconv-lite';
import { GrfBase, GrfOptions } from './grf-base';
import { bufferPool } from './buffer-pool';
import { setKoreanCodec } from './decoder';

// A static import, so both the CommonJS and the ES module builds load iconv-lite (see decoder.ts).
// Buffer.from over the same memory: iconv-lite wants a Buffer, and a copy per name would be waste.
setKoreanCodec({
  decode: (bytes, encoding) => iconv.decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), encoding),
  encode: (text, encoding) => iconv.encode(text, encoding),
});

const readAsync = promisify(readCallback);

/** Options for GrfNode */
export interface GrfNodeOptions extends GrfOptions {
  /** Use buffer pool for better performance (default: true) */
  useBufferPool?: boolean;
}

export class GrfNode extends GrfBase<number> {
  private useBufferPool: boolean;

  constructor(fd: number, options?: GrfNodeOptions) {
    super(fd, options);

    this.useBufferPool = options?.useBufferPool ?? true;

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

  public async getStreamBuffer(
    fd: number,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    // Use buffer pool for better performance
    const buffer = this.useBufferPool
      ? bufferPool.acquire(length)
      : Buffer.allocUnsafe(length);

    const { bytesRead } = await readAsync(fd, buffer, 0, length, offset);

    if (bytesRead !== length) {
      // Release buffer back to pool if read failed
      if (this.useBufferPool) {
        bufferPool.release(buffer);
      }
      // ERRO TYPE: GRFNode: unexpected EOF
      throw new Error('Not a GRF file (invalid signature)');
    }

    return buffer;
  }
}
