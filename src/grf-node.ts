import { read } from 'fs';
import { GrfBase } from './grf-base';

/**
 * Ambiente Node: trabalha a partir de um file descriptor (fd) em vez de
 * carregar todo o arquivo na memória.
 *
 * Uso:
 *   const fd  = openSync('path/to/file.grf', 'r');
 *   const grf = new GrfNode(fd);
 */
export class GrfNode extends GrfBase<number> {
  public async getStreamBuffer(
    fd: number,
    offset: number,
    length: number
  ): Promise<Uint8Array> {
    // Buffer é um subtipo de Uint8Array, compatível com a assinatura da base
    const buffer = Buffer.allocUnsafe(length);

    // Promessa explicitamente tipada como void
    await new Promise<void>((resolve, reject) => {
      read(fd, buffer, 0, length, offset, (error) =>
        error ? reject(error) : resolve()
      );
    });

    return buffer;
  }
}
