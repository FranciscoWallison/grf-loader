/**
 * Build small GRF 0x200 archives in memory, for tests.
 *
 * Lets a test put any name in an archive -- Korean names stored as CP949 bytes, like real client
 * archives -- and any kind of entry, without shipping game assets.
 *
 *   header (46 bytes)  "Master of Magic" NUL, 14-byte key, u32 tableOffset, u32 seed,
 *                      u32 nFiles (= count + seed + 7), u32 version 0x200
 *   file bodies        back to back
 *   table header       u32 packSize, u32 realSize
 *   table (zlib)       per entry: name bytes, NUL, u32 compressedSize, u32 lengthAligned,
 *                      u32 realSize, u8 type (0x01 = file), u32 offset
 *
 * Offsets are relative to the end of the header.
 */
import {deflateSync} from 'zlib';
import iconv from 'iconv-lite';

export interface BuilderEntry {
  /** Stored as CP949 bytes; a Buffer is stored as is, for names no encoder would produce. */
  name: string | Buffer;
  content: Buffer | string;
  /** Store without compression (realSize === compressedSize). */
  stored?: boolean;
  /**
   * Bytes after the content that still belong to the entry (lengthAligned > compressedSize), as DES
   * alignment leaves them. Filled with 0xAA so a reader that returns them is caught.
   */
  padding?: number;
}

export function buildGrf(entries: BuilderEntry[]): Buffer {
  const bodies: Buffer[] = [];
  const table: Buffer[] = [];
  let cursor = 0;

  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const body = entry.stored ? content : deflateSync(content);
    if (!entry.stored && body.length === content.length) {
      throw new Error(`"${entry.name}" deflates to its own length; the reader would take it as stored`);
    }
    const padding = Buffer.alloc(entry.padding ?? 0, 0xaa);

    const meta = Buffer.alloc(17);
    meta.writeUInt32LE(body.length, 0); // compressedSize
    meta.writeUInt32LE(body.length + padding.length, 4); // lengthAligned
    meta.writeUInt32LE(content.length, 8); // realSize
    meta.writeUInt8(0x01, 12); // type: file
    meta.writeUInt32LE(cursor, 13); // offset

    const name = Buffer.isBuffer(entry.name) ? entry.name : iconv.encode(entry.name, 'cp949');
    table.push(name, Buffer.from([0]), meta);
    bodies.push(body, padding);
    cursor += body.length + padding.length;
  }

  const rawTable = Buffer.concat(table);
  const packedTable = deflateSync(rawTable);
  const tableHeader = Buffer.alloc(8);
  tableHeader.writeUInt32LE(packedTable.length, 0);
  tableHeader.writeUInt32LE(rawTable.length, 4);

  const header = Buffer.alloc(46);
  header.write('Master of Magic\0', 0, 'ascii');
  header.writeUInt32LE(cursor, 30); // the table follows the bodies
  header.writeUInt32LE(0, 34); // seed
  header.writeUInt32LE(entries.length + 7, 38);
  header.writeUInt32LE(0x200, 42);

  return Buffer.concat([header, ...bodies, tableHeader, packedTable]);
}
