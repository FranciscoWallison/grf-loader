import pako from 'pako';
import jDataview from 'jdataview';
import {decodeFull, decodeHeader} from './des';
import {
  decodeBytes,
  detectBestKoreanEncoding,
  countBadChars,
  countReplacementChars,
  countC1ControlChars,
  hasIconvLite
} from './decoder';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface TFileEntry {
  type: number;
  offset: number;
  realSize: number;
  compressedSize: number;
  lengthAligned: number;
  /** Raw filename bytes for re-decoding if needed */
  rawNameBytes?: Uint8Array;
}

/** Supported filename encodings */
export type FilenameEncoding = 'utf-8' | 'euc-kr' | 'cp949' | 'latin1' | 'auto';

/** GRF loader options */
export interface GrfOptions {
  /** Encoding for filenames (default: 'auto') */
  filenameEncoding?: FilenameEncoding;
  /** Threshold for auto-detection: if % of U+FFFD exceeds this, try Korean encodings (default: 0.01 = 1%) */
  autoDetectThreshold?: number;
  /** Maximum uncompressed size per file in bytes (default: 256MB) */
  maxFileUncompressedBytes?: number;
  /** Maximum total entries allowed (default: 500000) */
  maxEntries?: number;
}

/** Search/find options */
export interface FindOptions {
  /** Filter by file extension (without dot, e.g., 'spr', 'act') */
  ext?: string;
  /** Filter by substring in path */
  contains?: string;
  /** Filter by path ending */
  endsWith?: string;
  /** Filter by regex pattern */
  regex?: RegExp;
  /** Maximum results to return (default: unlimited) */
  limit?: number;
}

/** Result of path resolution */
export interface ResolveResult {
  status: 'found' | 'not_found' | 'ambiguous';
  /** The exact matched path (if found) */
  matchedPath?: string;
  /** All candidate paths (if ambiguous) */
  candidates?: string[];
}

/** GRF statistics */
export interface GrfStats {
  /** Total file count */
  fileCount: number;
  /** Number of filenames with replacement character (U+FFFD) */
  badNameCount: number;
  /** Number of normalized key collisions */
  collisionCount: number;
  /** Extension statistics: ext -> count */
  extensionStats: Map<string, number>;
  /** Detected encoding used */
  detectedEncoding: FilenameEncoding;
}

// ============================================================================
// Error Codes
// ============================================================================

export const GRF_ERROR_CODES = {
  INVALID_MAGIC: 'GRF_INVALID_MAGIC',
  UNSUPPORTED_VERSION: 'GRF_UNSUPPORTED_VERSION',
  NOT_LOADED: 'GRF_NOT_LOADED',
  FILE_NOT_FOUND: 'GRF_FILE_NOT_FOUND',
  AMBIGUOUS_PATH: 'GRF_AMBIGUOUS_PATH',
  DECOMPRESS_FAIL: 'GRF_DECOMPRESS_FAIL',
  CORRUPT_TABLE: 'GRF_CORRUPT_TABLE',
  LIMIT_EXCEEDED: 'GRF_LIMIT_EXCEEDED',
  INVALID_OFFSET: 'GRF_INVALID_OFFSET',
  DECRYPT_REQUIRED: 'GRF_DECRYPT_REQUIRED',
} as const;

export class GrfError extends Error {
  constructor(
    public code: keyof typeof GRF_ERROR_CODES,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GrfError';
  }
}

const FILELIST_TYPE_FILE = 0x01;
const FILELIST_TYPE_ENCRYPT_MIXED = 0x02; // encryption mode 0 (header DES + periodic DES/shuffle)
const FILELIST_TYPE_ENCRYPT_HEADER = 0x04; // encryption mode 1 (header DES only)

const HEADER_SIGNATURE = 'Master of Magic';
const HEADER_SIZE = 46;
const FILE_TABLE_SIZE = Uint32Array.BYTES_PER_ELEMENT * 2;

// Default limits
const DEFAULT_MAX_FILE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024; // 256MB
const DEFAULT_MAX_ENTRIES = 500000;
const DEFAULT_AUTO_DETECT_THRESHOLD = 0.01; // 1%

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize a path for case-insensitive, slash-agnostic lookup
 */
function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/');
}

/**
 * Get file extension from path (lowercase, without dot)
 */
function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1 || lastDot === path.length - 1) return '';
  return path.substring(lastDot + 1).toLowerCase();
}

// Note: countReplacementChars, countBadChars, countC1ControlChars, decodeBytes,
// and detectBestKoreanEncoding are imported from './decoder'

/**
 * Decode filename bytes with specified encoding.
 * Uses iconv-lite for Korean encodings in Node.js for proper CP949 support.
 */
function decodeFilenameBytes(bytes: Uint8Array, encoding: FilenameEncoding): string {
  // For Korean encodings, always use 'cp949' as it's a superset of euc-kr
  // This ensures proper handling of extended Korean characters
  const actualEncoding = (encoding === 'euc-kr' || encoding === 'cp949') ? 'cp949' : encoding;
  return decodeBytes(bytes, actualEncoding);
}

// ============================================================================
// GrfBase Class
// ============================================================================

export abstract class GrfBase<T> {
  public version = 0x200;
  public fileCount = 0;
  public loaded = false;

  /** Map of exact filename -> entry */
  public files = new Map<string, TFileEntry>();

  /** Map of normalized path -> array of exact filenames (supports collisions) */
  private normalizedIndex = new Map<string, string[]>();

  /** Map of extension -> array of exact filenames (for fast extension lookup) */
  private extensionIndex = new Map<string, string[]>();

  private fileTableOffset = 0;
  private cache = new Map<string, Uint8Array>();
  private cacheMaxSize = 50;
  private cacheOrder: string[] = [];

  // Options
  protected options: Required<GrfOptions>;

  // Statistics
  private _stats: GrfStats = {
    fileCount: 0,
    badNameCount: 0,
    collisionCount: 0,
    extensionStats: new Map(),
    detectedEncoding: 'utf-8'
  };

  constructor(private fd: T, options?: GrfOptions) {
    this.options = {
      filenameEncoding: options?.filenameEncoding ?? 'auto',
      autoDetectThreshold: options?.autoDetectThreshold ?? DEFAULT_AUTO_DETECT_THRESHOLD,
      maxFileUncompressedBytes: options?.maxFileUncompressedBytes ?? DEFAULT_MAX_FILE_UNCOMPRESSED_BYTES,
      maxEntries: options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    };
  }

  abstract getStreamBuffer(
    fd: T,
    offset: number,
    length: number
  ): Promise<Uint8Array>;

  public async getStreamReader(
    offset: number,
    length: number
  ): Promise<jDataview> {
    const buffer = await this.getStreamBuffer(this.fd, offset, length);

    return new jDataview(buffer, void 0, void 0, true);
  }

  public async load(): Promise<void> {
    if (!this.loaded) {
      await this.parseHeader();
      await this.parseFileList();
      this.loaded = true;
    }
  }

  private async parseHeader(): Promise<void> {
    const reader = await this.getStreamReader(0, HEADER_SIZE);

    const signature = reader.getString(15);
    if (signature !== HEADER_SIGNATURE) {
      throw new GrfError('INVALID_MAGIC', 'Not a GRF file (invalid signature)', { signature });
    }

    reader.skip(15);
    // Now at offset 30. Version is always at offset 42 for both 0x200 and 0x300.
    // Read version first to determine how to parse the rest of the header.
    // Save position, peek version, then parse based on version.
    const afterKey = reader.tell();
    reader.seek(42);
    this.version = reader.getUint32();

    if (this.version !== 0x200 && this.version !== 0x300) {
      throw new GrfError('UNSUPPORTED_VERSION', `Unsupported version "0x${this.version.toString(16)}"`, { version: this.version });
    }

    reader.seek(afterKey);

    if (this.version === 0x200) {
      // 0x200: [table_offset:u32][seeds:u32][filecount:u32][version:u32]
      this.fileTableOffset = reader.getUint32() + HEADER_SIZE;
      const reservedFiles = reader.getUint32();
      this.fileCount = reader.getUint32() - reservedFiles - 7;
    } else {
      // 0x300: [table_offset:u64][filecount:u32][version:u32]
      const low = reader.getUint32();
      const high = reader.getUint32();

      // GRFEditor heuristic: bytes 35-37 (upper 3 bytes of high word) must be zero.
      // Protects against mis-tagged GRFs where version says 0x300 but layout is 0x200.
      if ((high >>> 8) !== 0) {
        // Fall back to 0x200 parsing
        this.version = 0x200;
        reader.seek(afterKey);
        this.fileTableOffset = reader.getUint32() + HEADER_SIZE;
        const reservedFiles = reader.getUint32();
        this.fileCount = reader.getUint32() - reservedFiles - 7;
      } else {
        this.fileTableOffset = high * 0x100000000 + low + HEADER_SIZE;
        this.fileCount = reader.getUint32();
      }
    }

    // Validate entry count against limit
    if (this.fileCount > this.options.maxEntries) {
      throw new GrfError('LIMIT_EXCEEDED', `File count ${this.fileCount} exceeds limit ${this.options.maxEntries}`, {
        fileCount: this.fileCount,
        maxEntries: this.options.maxEntries
      });
    }
  }

  private async parseFileList(): Promise<void> {
    // GRF 0x300 has an extra 4-byte field before the file table header
    const tableSkip = this.version === 0x300 ? 4 : 0;

    // Read table list, stored information
    const reader = await this.getStreamReader(
      this.fileTableOffset + tableSkip,
      FILE_TABLE_SIZE
    );
    const compressedSize = reader.getUint32();
    const realSize = reader.getUint32();

    // Load the chunk and uncompress it
    const compressed = await this.getStreamBuffer(
      this.fd,
      this.fileTableOffset + tableSkip + FILE_TABLE_SIZE,
      compressedSize
    );

    let data: Uint8Array;
    try {
      data = pako.inflate(compressed);
    } catch (error) {
      throw new GrfError('CORRUPT_TABLE', 'Failed to decompress file table', {
        compressedSize,
        realSize,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Validate decompressed size
    if (data.length !== realSize) {
      throw new GrfError('CORRUPT_TABLE', `File table size mismatch: expected ${realSize}, got ${data.length}`, {
        expected: realSize,
        actual: data.length
      });
    }

    // Determine encoding to use
    let detectedEncoding: FilenameEncoding = this.options.filenameEncoding;

    // If auto-detect, sample filenames and use improved detection algorithm
    if (this.options.filenameEncoding === 'auto') {
      const sampleBytes: Uint8Array[] = [];
      let samplePos = 0;
      // Sample more files for better detection accuracy
      const sampleCount = Math.min(200, this.fileCount);
      // 0x200: 17-byte entries (4-byte offset), 0x300: 21-byte entries (8-byte offset)
      const entryDataSize = this.version === 0x300 ? 21 : 17;

      for (let i = 0; i < sampleCount && samplePos < data.length; i++) {
        let endPos = samplePos;
        while (data[endPos] !== 0 && endPos < data.length) endPos++;

        // Only include samples with non-ASCII bytes for detection
        const bytes = data.subarray(samplePos, endPos);
        sampleBytes.push(bytes);

        samplePos = endPos + 1 + entryDataSize;
      }

      // Use improved encoding detection algorithm from decoder module
      // This analyzes:
      // 1. Valid byte sequence patterns for UTF-8 vs EUC-KR/CP949
      // 2. Replacement character ratios after decoding (including C1 control chars)
      // 3. Uses iconv-lite in Node.js for proper CP949 support
      detectedEncoding = detectBestKoreanEncoding(sampleBytes, this.options.autoDetectThreshold);
    }

    this._stats.detectedEncoding = detectedEncoding;

    // Reset stats
    this._stats.badNameCount = 0;
    this._stats.collisionCount = 0;
    this._stats.extensionStats.clear();

    // 0x200: 17-byte entries (4-byte offset), 0x300: 21-byte entries (8-byte offset)
    const entryDataSize = this.version === 0x300 ? 21 : 17;

    for (let i = 0, p = 0; i < this.fileCount; ++i) {
      // Validate position
      if (p >= data.length) {
        throw new GrfError('CORRUPT_TABLE', `Unexpected end of file table at entry ${i}`, {
          position: p,
          dataLength: data.length,
          entryIndex: i
        });
      }

      // Find null terminator
      let endPos = p;
      while (data[endPos] !== 0 && endPos < data.length) {
        endPos++;
      }

      // Store raw bytes and decode filename using the detected encoding
      // Uses iconv-lite for Korean encodings in Node.js for proper CP949 support
      const rawBytes = data.slice(p, endPos); // Copy for storage
      const filename = decodeFilenameBytes(rawBytes, detectedEncoding);

      // Count bad names (including C1 control chars that indicate wrong decode)
      if (countBadChars(filename) > 0) {
        this._stats.badNameCount++;
      }

      p = endPos + 1;

      // Validate remaining bytes for entry
      if (p + entryDataSize > data.length) {
        throw new GrfError('CORRUPT_TABLE', `Incomplete entry data at entry ${i}`, {
          position: p,
          dataLength: data.length,
          entryIndex: i
        });
      }

      // prettier-ignore
      const compressedSize = data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24);
      // prettier-ignore
      const lengthAligned = data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24);
      // prettier-ignore
      const realSize = data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24);
      const type = data[p++];

      let offset: number;
      if (this.version === 0x300) {
        // 0x300: 8-byte (64-bit) offset
        // prettier-ignore
        const low = (data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24)) >>> 0;
        // prettier-ignore
        const high = (data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24)) >>> 0;
        offset = high * 0x100000000 + low;
      } else {
        // 0x200: 4-byte (32-bit) offset
        // prettier-ignore
        offset = (data[p++] | (data[p++] << 8) | (data[p++] << 16) | (data[p++] << 24)) >>> 0;
      }

      const entry: TFileEntry = {
        compressedSize,
        lengthAligned,
        realSize,
        type,
        offset,
        rawNameBytes: rawBytes
      };

      // Validate sizes against limits
      if (entry.realSize > this.options.maxFileUncompressedBytes) {
        // Skip this entry but don't fail - just warn
        continue;
      }

      // Only process files (not folders)
      if (entry.type & FILELIST_TYPE_FILE) {
        // Add to main files map
        this.files.set(filename, entry);

        // Add to normalized index (supports collisions)
        const normalizedKey = normalizePath(filename);
        const existingNorm = this.normalizedIndex.get(normalizedKey);
        if (existingNorm) {
          existingNorm.push(filename);
          this._stats.collisionCount++;
        } else {
          this.normalizedIndex.set(normalizedKey, [filename]);
        }

        // Add to extension index
        const ext = getExtension(filename);
        if (ext) {
          const existingExt = this.extensionIndex.get(ext);
          if (existingExt) {
            existingExt.push(filename);
          } else {
            this.extensionIndex.set(ext, [filename]);
          }

          // Update extension stats
          this._stats.extensionStats.set(ext, (this._stats.extensionStats.get(ext) || 0) + 1);
        }
      }
    }

    this._stats.fileCount = this.files.size;
  }

  private decodeEntry(data: Uint8Array, entry: TFileEntry): Uint8Array {
    // Decode the file
    if (entry.type & FILELIST_TYPE_ENCRYPT_MIXED) {
      decodeFull(data, entry.lengthAligned, entry.compressedSize);
    } else if (entry.type & FILELIST_TYPE_ENCRYPT_HEADER) {
      decodeHeader(data, entry.lengthAligned);
    }

    // No compression
    if (entry.realSize === entry.compressedSize) {
      return data;
    }

    // Uncompress
    return pako.inflate(data);
  }

  private addToCache(filename: string, data: Uint8Array): void {
    // Remove oldest if cache is full
    if (this.cacheOrder.length >= this.cacheMaxSize) {
      const oldest = this.cacheOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    // Add to cache
    this.cache.set(filename, data);
    this.cacheOrder.push(filename);
  }

  private getFromCache(filename: string): Uint8Array | undefined {
    const cached = this.cache.get(filename);
    if (cached) {
      // Move to end (most recently used)
      const index = this.cacheOrder.indexOf(filename);
      if (index > -1) {
        this.cacheOrder.splice(index, 1);
        this.cacheOrder.push(filename);
      }
    }
    return cached;
  }

  public clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }

  public async getFile(
    filename: string
  ): Promise<{data: null | Uint8Array; error: null | string}> {
    if (!this.loaded) {
      return Promise.resolve({data: null, error: 'GRF not loaded yet'});
    }

    // Try to resolve the path (exact match first, then normalized)
    const resolved = this.resolvePath(filename);

    if (resolved.status === 'not_found') {
      return Promise.resolve({data: null, error: `File "${filename}" not found`});
    }

    if (resolved.status === 'ambiguous') {
      return Promise.resolve({
        data: null,
        error: `Ambiguous path "${filename}": ${resolved.candidates?.length} matches found. Use exact path: ${resolved.candidates?.slice(0, 5).join(', ')}${(resolved.candidates?.length || 0) > 5 ? '...' : ''}`
      });
    }

    const path = resolved.matchedPath!;

    // Check cache first
    const cached = this.getFromCache(path);
    if (cached) {
      return Promise.resolve({data: cached, error: null});
    }

    const entry = this.files.get(path);

    if (!entry) {
      return { data: null, error: `File "${path}" not found` };
    }

    const data = await this.getStreamBuffer(
      this.fd,
      entry.offset + HEADER_SIZE,
      entry.lengthAligned
    );

    try {
      const result = this.decodeEntry(data, entry);

      // Add to cache
      this.addToCache(path, result);

      return Promise.resolve({data: result, error: null});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { data: null, error: message };
    }
  }

  // ===========================================================================
  // Path Resolution
  // ===========================================================================

  /**
   * Resolve a path to its exact filename in the GRF.
   * Tries exact match first, then normalized (case-insensitive, slash-agnostic).
   */
  public resolvePath(query: string): ResolveResult {
    // Try exact match first
    if (this.files.has(query)) {
      return { status: 'found', matchedPath: query };
    }

    // Try normalized lookup
    const normalizedQuery = normalizePath(query);
    const candidates = this.normalizedIndex.get(normalizedQuery);

    if (!candidates || candidates.length === 0) {
      return { status: 'not_found' };
    }

    if (candidates.length === 1) {
      return { status: 'found', matchedPath: candidates[0] };
    }

    // Multiple candidates - ambiguous
    return { status: 'ambiguous', candidates };
  }

  /**
   * Check if a file exists in the GRF.
   */
  public hasFile(filename: string): boolean {
    const resolved = this.resolvePath(filename);
    return resolved.status === 'found';
  }

  /**
   * Get file entry metadata without extracting the file.
   */
  public getEntry(filename: string): TFileEntry | null {
    const resolved = this.resolvePath(filename);
    if (resolved.status !== 'found' || !resolved.matchedPath) {
      return null;
    }
    return this.files.get(resolved.matchedPath) || null;
  }

  // ===========================================================================
  // Search API
  // ===========================================================================

  /**
   * Find files matching the given criteria.
   */
  public find(options: FindOptions = {}): string[] {
    const { ext, contains, endsWith, regex, limit } = options;
    let results: string[] = [];

    // If searching by extension only, use the extension index (fast path)
    if (ext && !contains && !endsWith && !regex) {
      const extLower = ext.toLowerCase().replace(/^\./, ''); // Remove leading dot if present
      results = this.extensionIndex.get(extLower) || [];
    } else {
      // Full search
      for (const filename of this.files.keys()) {
        // Extension filter
        if (ext) {
          const extLower = ext.toLowerCase().replace(/^\./, '');
          if (getExtension(filename) !== extLower) continue;
        }

        // Contains filter (case-insensitive)
        if (contains) {
          const normalizedFilename = normalizePath(filename);
          const normalizedContains = normalizePath(contains);
          if (!normalizedFilename.includes(normalizedContains)) continue;
        }

        // EndsWith filter (case-insensitive)
        if (endsWith) {
          const normalizedFilename = normalizePath(filename);
          const normalizedEndsWith = normalizePath(endsWith);
          if (!normalizedFilename.endsWith(normalizedEndsWith)) continue;
        }

        // Regex filter
        if (regex && !regex.test(filename)) continue;

        results.push(filename);

        // Limit check
        if (limit && results.length >= limit) break;
      }
    }

    // Apply limit if not already applied
    if (limit && results.length > limit) {
      results = results.slice(0, limit);
    }

    return results;
  }

  /**
   * Get all files with a specific extension.
   */
  public getFilesByExtension(ext: string): string[] {
    const extLower = ext.toLowerCase().replace(/^\./, '');
    return this.extensionIndex.get(extLower) || [];
  }

  /**
   * List all unique extensions in the GRF.
   */
  public listExtensions(): string[] {
    return Array.from(this.extensionIndex.keys()).sort();
  }

  /**
   * List all files in the GRF.
   */
  public listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get GRF statistics.
   */
  public getStats(): GrfStats {
    return { ...this._stats, extensionStats: new Map(this._stats.extensionStats) };
  }

  /**
   * Get the detected/configured encoding used for filenames.
   */
  public getDetectedEncoding(): FilenameEncoding {
    return this._stats.detectedEncoding;
  }

  // ===========================================================================
  // Re-decoding Support
  // ===========================================================================

  /**
   * Re-decode all filenames with a different encoding.
   * Useful if auto-detection chose wrong or you want to try a specific encoding.
   */
  public async reloadWithEncoding(encoding: FilenameEncoding): Promise<void> {
    this.options.filenameEncoding = encoding;
    this.files.clear();
    this.normalizedIndex.clear();
    this.extensionIndex.clear();
    this.clearCache();
    this.loaded = false;
    await this.load();
  }
}
