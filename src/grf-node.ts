// src/grf-node.ts
import { readSync, fstatSync } from 'fs';
import { GrfBase } from './grf-base';

export class GrfNode extends GrfBase<number> {
  constructor(fd: number) {
    super(fd);

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
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);

    if (bytesRead !== length) {
      // ERRO TYPE: GRFNode: unexpected EOF
      throw new Error('Not a GRF file (invalid signature)');
    }
    return buffer;
  }
}
