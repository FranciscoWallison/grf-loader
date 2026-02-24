/**
 * Generate a GRF version 0x300 test fixture.
 *
 * Reads the existing with-files.grf (0x200) and creates
 * with-files-v300.grf using the 0x300 format.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { inflateSync, deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(__dirname, '../data/with-files.grf');
const dstPath = resolve(__dirname, '../data/with-files-v300.grf');

const HEADER_SIZE = 46;
const src = readFileSync(srcPath);

// ============================================================================
// Parse 0x200
// ============================================================================

const signature = src.toString('ascii', 0, 15);
const key = src.slice(15, 30);
const tableOffsetRaw = src.readUInt32LE(30);
const seed = src.readUInt32LE(34);
const rawCount = src.readUInt32LE(38);
const fileCount = rawCount - seed - 7;
const tableOffset = tableOffsetRaw + HEADER_SIZE;

console.log('=== Source (0x200) ===');
console.log('FileCount:', fileCount, ' TableOffset:', tableOffset);

// File data area
const fileDataArea = src.slice(HEADER_SIZE, tableOffset);

// File table
const compSize = src.readUInt32LE(tableOffset);
const realSize = src.readUInt32LE(tableOffset + 4);
const compData = src.slice(tableOffset + 8, tableOffset + 8 + compSize);
const tableData = inflateSync(compData);

// Parse entries
const entries = [];
let p = 0;
for (let i = 0; i < fileCount; i++) {
  let endPos = p;
  while (tableData[endPos] !== 0) endPos++;
  const nameBytes = Buffer.from(tableData.slice(p, endPos));
  const name = nameBytes.toString('ascii');
  p = endPos + 1;

  const compressedSize = tableData.readInt32LE(p); p += 4;
  const lengthAligned  = tableData.readInt32LE(p); p += 4;
  const realSz         = tableData.readInt32LE(p); p += 4;
  const type           = tableData[p++];
  const offset         = tableData.readUInt32LE(p); p += 4;

  entries.push({ name, nameBytes, compressedSize, lengthAligned, realSize: realSz, type, offset });
  console.log(`  [${i}] "${name}" type=0x${type.toString(16)} offset=${offset}`);
}

// ============================================================================
// Build 0x300
// ============================================================================

console.log('\n=== Building 0x300 ===');

// Build entry table with 21-byte entries (8-byte offset)
const parts = [];
for (const entry of entries) {
  // filename + null
  const nameBuf = Buffer.alloc(entry.nameBytes.length + 1);
  entry.nameBytes.copy(nameBuf);

  // 21 bytes: compressedSize(4) + lengthAligned(4) + realSize(4) + type(1) + offset_low(4) + offset_high(4)
  const dataBuf = Buffer.alloc(21);
  dataBuf.writeInt32LE(entry.compressedSize, 0);
  dataBuf.writeInt32LE(entry.lengthAligned, 4);
  dataBuf.writeInt32LE(entry.realSize, 8);
  dataBuf[12] = entry.type;
  dataBuf.writeUInt32LE(entry.offset >>> 0, 13);
  dataBuf.writeUInt32LE(0, 17);  // high = 0

  parts.push(nameBuf, dataBuf);
}
const rawTable = Buffer.concat(parts);
const compressedTable = deflateSync(rawTable);

console.log('Raw table:', rawTable.length, 'bytes');
console.log('Compressed table:', compressedTable.length, 'bytes');

// Header (46 bytes)
const header = Buffer.alloc(HEADER_SIZE);
header.write('Master of Magic', 0, 15, 'ascii');
key.copy(header, 15);
// 64-bit table offset
header.writeUInt32LE(fileDataArea.length, 30);  // low
header.writeUInt32LE(0, 34);                     // high
// File count (direct, no seed)
header.writeUInt32LE(fileCount, 38);
// Version
header.writeUInt32LE(0x300, 42);

// Table header: [skip:4] [compressedSize:4] [realSize:4]
const tableHdr = Buffer.alloc(12);
tableHdr.writeUInt32LE(0, 0);
tableHdr.writeUInt32LE(compressedTable.length, 4);
tableHdr.writeUInt32LE(rawTable.length, 8);

// Concatenate
const output = Buffer.concat([header, fileDataArea, tableHdr, compressedTable]);

// ============================================================================
// Verify
// ============================================================================

console.log('\n=== Verification ===');
console.log('Output size:', output.length);
console.log('Version: 0x' + output.readUInt32LE(42).toString(16));
console.log('Bytes 35-37:', output[35], output[36], output[37]);
console.log('FileCount:', output.readUInt32LE(38));

// Read back and verify
const readOff = output.readUInt32LE(30) + HEADER_SIZE;
const readSkip = output.readUInt32LE(readOff);
const readCS = output.readUInt32LE(readOff + 4);
const readRS = output.readUInt32LE(readOff + 8);
const readCD = output.slice(readOff + 12, readOff + 12 + readCS);
const readTD = inflateSync(readCD);
console.log('Skip:', readSkip, ' CompSize:', readCS, ' RealSize:', readRS);
console.log('Decompressed:', readTD.length, '(expected', readRS, ')');

let pp = 0;
for (let i = 0; i < fileCount; i++) {
  let e = pp;
  while (readTD[e] !== 0) e++;
  const name = readTD.slice(pp, e).toString('ascii');
  pp = e + 1;
  const cs = readTD.readInt32LE(pp); pp += 4;
  const la = readTD.readInt32LE(pp); pp += 4;
  const rs = readTD.readInt32LE(pp); pp += 4;
  const tp = readTD[pp++];
  const lo = readTD.readUInt32LE(pp); pp += 4;
  const hi = readTD.readUInt32LE(pp); pp += 4;
  console.log(`  [${i}] "${name}" comp=${cs} aligned=${la} real=${rs} type=0x${tp.toString(16)} offset=${hi * 0x100000000 + lo}`);
}

writeFileSync(dstPath, output);
console.log('\nWritten:', dstPath);
