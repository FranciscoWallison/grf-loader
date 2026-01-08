# GRF Loader

**GRF** is an archive file format that supports lossless data compression used on **Ragnarok Online** to store game assets. A GRF file may contain one or more files or directories that may have been compressed (deflate) and encrypted (variant of DES).

[![roBrowser project](https://img.shields.io/badge/project-roBrowser-informational.svg)](https://github.com/vthibault/roBrowser) [![license: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)
![node](https://github.com/vthibault/grf-loader/workflows/node/badge.svg?branch=master) ![browser](https://github.com/vthibault/grf-loader/workflows/browser/badge.svg?branch=master) ![lint](https://github.com/vthibault/grf-loader/workflows/lint/badge.svg?branch=master)

## Features

- ✅ GRF version 0x200 support
- ✅ Works in both Node.js and browser environments
- ✅ DES decryption support
- ✅ **Korean filename encoding (CP949/EUC-KR)** with auto-detection
- ✅ **Mojibake detection and fixing**
- ✅ **Case-insensitive path resolution**
- ✅ **Collision-safe indexing** (no lost files)
- ✅ Memory efficient (streams data without loading entire file)
- ❌ Custom encryption not supported

## Installation

```bash
npm install @chicowall/grf-loader
```

## Quick Start

### Node.js

```ts
import { GrfNode } from '@chicowall/grf-loader';
import { openSync } from 'fs';

const fd = openSync('path/to/data.grf', 'r');
const grf = new GrfNode(fd);

await grf.load();

// Get file
const { data, error } = await grf.getFile('data\\sprite\\monster.spr');
```

### Browser

```ts
import { GrfBrowser } from '@chicowall/grf-loader';

const file = document.querySelector('input[type="file"]').files[0];
const grf = new GrfBrowser(file);

await grf.load();
```

## Configuration Options

```ts
const grf = new GrfNode(fd, {
  // Filename encoding: 'auto' | 'cp949' | 'euc-kr' | 'utf-8' | 'latin1'
  filenameEncoding: 'auto',

  // Auto-detection threshold for bad characters (default: 1%)
  autoDetectThreshold: 0.01,

  // Maximum uncompressed file size (default: 256MB)
  maxFileUncompressedBytes: 256 * 1024 * 1024,

  // Maximum entries allowed (default: 500,000)
  maxEntries: 500000
});
```

## API Reference

### File Operations

```ts
// Get file data
const { data, error } = await grf.getFile('data\\clientinfo.xml');

// Check if file exists (case-insensitive)
grf.hasFile('DATA\\CLIENTINFO.XML'); // true

// Get file entry metadata
const entry = grf.getEntry('data\\clientinfo.xml');
// { type, offset, realSize, compressedSize, lengthAligned, rawNameBytes }

// Resolve path (handles case-insensitivity and collisions)
const result = grf.resolvePath('DATA\\Sprite\\Test.spr');
// { status: 'found' | 'not_found' | 'ambiguous', matchedPath?, candidates? }
```

### Search API

```ts
// Find files with multiple filters
const files = grf.find({
  ext: 'spr',              // Filter by extension
  contains: 'monster',      // Filter by substring (case-insensitive)
  endsWith: 'poring.spr',  // Filter by path ending
  regex: /^data\\sprite/,  // Filter by regex
  limit: 100               // Max results
});

// Get all files by extension (fast, uses index)
const sprites = grf.getFilesByExtension('spr');
const textures = grf.getFilesByExtension('bmp');

// List all unique extensions
const extensions = grf.listExtensions();
// ['spr', 'act', 'bmp', 'wav', ...]

// List all files
const allFiles = grf.listFiles();
```

### Statistics

```ts
const stats = grf.getStats();
// {
//   fileCount: 203092,
//   badNameCount: 4,        // Files with encoding issues
//   collisionCount: 0,      // Normalized path collisions
//   extensionStats: Map,    // Extension -> count
//   detectedEncoding: 'cp949'
// }

// Get detected encoding
const encoding = grf.getDetectedEncoding(); // 'cp949' | 'utf-8' | ...
```

### Encoding Utilities

```ts
import {
  isMojibake,
  fixMojibake,
  normalizeFilename,
  normalizeEncodingPath,
  countBadChars,
  hasIconvLite
} from '@chicowall/grf-loader';

// Detect mojibake (CP949 misread as Windows-1252)
isMojibake('À¯ÀúÀÎÅÍÆäÀÌ½º'); // true
isMojibake('유저인터페이스');     // false

// Fix mojibake
fixMojibake('À¯ÀúÀÎÅÍÆäÀÌ½º'); // '유저인터페이스'

// Normalize entire path
normalizeEncodingPath('data\\texture\\À¯ÀúÀÎÅÍÆäÀÌ½º\\test.bmp');
// 'data\\texture\\유저인터페이스\\test.bmp'

// Count problematic characters
countBadChars('test�file.txt'); // 1 (U+FFFD replacement char)

// Check if iconv-lite is available (Node.js only)
hasIconvLite(); // true in Node.js, false in browser
```

## Korean Encoding Support

GRF files from Korean Ragnarok Online clients use CP949 encoding for filenames. This library automatically detects and handles Korean encoding:

```ts
// Auto-detection (default)
const grf = new GrfNode(fd, { filenameEncoding: 'auto' });

// Force CP949
const grf = new GrfNode(fd, { filenameEncoding: 'cp949' });

// Reload with different encoding
await grf.reloadWithEncoding('euc-kr');
```

### Encoding Detection Results

| Scenario | Detection | Result |
|----------|-----------|--------|
| Korean GRF | `cp949` | ✅ Proper Korean display |
| English GRF | `utf-8` | ✅ ASCII preserved |
| Mixed content | `cp949` | ✅ Both work |

## Error Handling

```ts
import { GrfError, GRF_ERROR_CODES } from '@chicowall/grf-loader';

try {
  await grf.load();
} catch (e) {
  if (e instanceof GrfError) {
    switch (e.code) {
      case 'INVALID_MAGIC':
        console.log('Not a GRF file');
        break;
      case 'UNSUPPORTED_VERSION':
        console.log('Only version 0x200 supported');
        break;
      case 'CORRUPT_TABLE':
        console.log('File table is corrupted');
        break;
      case 'LIMIT_EXCEEDED':
        console.log('File exceeds size limit');
        break;
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_MAGIC` | File is not a GRF (invalid signature) |
| `UNSUPPORTED_VERSION` | GRF version not 0x200 |
| `NOT_LOADED` | GRF not loaded yet |
| `FILE_NOT_FOUND` | Requested file not in archive |
| `AMBIGUOUS_PATH` | Multiple files match (collision) |
| `DECOMPRESS_FAIL` | Decompression failed |
| `CORRUPT_TABLE` | File table is corrupted |
| `LIMIT_EXCEEDED` | Size/count limit exceeded |

## Validation Tools

### Validate a Single GRF

```bash
npm run validate:grf -- path/to/data.grf auto 100
```

### Validate All GRFs in a Folder

```bash
npm run validate:all -- path/to/grf/folder auto
```

Output example:
```
================================================================================
SUMMARY
================================================================================
GRFs loaded:        3/3
Total files:        655,144
Bad U+FFFD:         12
Bad C1 Control:     40
Read tests passed:  300
Read tests failed:  0

Encoding Health:    99.99% (655,092/655,144 clean)
```

## Examples

### Extract All Files

```bash
npx ts-node examples/extract-all.ts path/to/data.grf output-directory
```

### List All Files by Extension

```ts
const grf = new GrfNode(fd);
await grf.load();

// Get all sprite files
const sprites = grf.getFilesByExtension('spr');
console.log(`Found ${sprites.length} sprite files`);

// Get extension statistics
const stats = grf.getStats();
for (const [ext, count] of stats.extensionStats) {
  console.log(`${ext}: ${count} files`);
}
```

### Handle Case-Insensitive Lookups

```ts
// All of these resolve to the same file:
await grf.getFile('data\\sprite\\monster.spr');
await grf.getFile('DATA\\SPRITE\\MONSTER.SPR');
await grf.getFile('data/sprite/monster.spr');
```

## Browser Limitations

- **iconv-lite** is not available in browsers
- CP949 extended characters may show as C1 control characters
- Use `hasIconvLite()` to check availability

## License

MIT
