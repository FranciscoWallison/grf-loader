/**
 * Korean encoding decoder module
 *
 * Uses iconv-lite in Node.js for proper CP949 support.
 * Falls back to TextDecoder in browser (with limitations for CP949 extended chars).
 */

// Try to import iconv-lite (available in Node.js)
let iconv: typeof import('iconv-lite') | null = null;

// Dynamic import for Node.js environment
try {
  // Use require for synchronous loading in Node.js
  // This will fail in browser environments
  if (typeof process !== 'undefined' && process.versions?.node) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    iconv = require('iconv-lite');
  }
} catch {
  // iconv-lite not available (browser environment)
  iconv = null;
}

/**
 * Check if we're in a Node.js environment with iconv-lite available
 */
export function hasIconvLite(): boolean {
  return iconv !== null;
}

/**
 * Count C1 control characters (U+0080-U+009F) in a string.
 * These usually indicate incorrectly decoded Korean bytes.
 * When EUC-KR decoder encounters CP949-extended bytes (0x80-0x9F range),
 * they get decoded as C1 control characters instead of Korean characters.
 */
export function countC1ControlChars(str: string): number {
  let count = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    if (code >= 0x80 && code <= 0x9F) {
      count++;
    }
  }
  return count;
}

/**
 * Count replacement characters (U+FFFD) in a string
 */
export function countReplacementChars(str: string): number {
  let count = 0;
  for (const char of str) {
    if (char === '\uFFFD') count++;
  }
  return count;
}

/**
 * Count total "bad" characters (replacement + C1 control)
 */
export function countBadChars(str: string): number {
  return countReplacementChars(str) + countC1ControlChars(str);
}

/**
 * Decode bytes to string using the specified encoding.
 *
 * For Korean encodings (cp949, euc-kr), uses iconv-lite in Node.js
 * for proper CP949 extended character support.
 *
 * @param bytes - The bytes to decode
 * @param encoding - The encoding to use ('utf-8', 'euc-kr', 'cp949', 'latin1')
 * @returns The decoded string
 */
export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  // Normalize encoding name
  const enc = encoding.toLowerCase();

  // For Korean encodings, prefer iconv-lite in Node.js
  // iconv-lite properly handles CP949 extended range (0x81-0xFE first byte)
  // which TextDecoder('euc-kr') doesn't fully support
  if ((enc === 'cp949' || enc === 'euc-kr') && iconv) {
    try {
      // Always use 'cp949' with iconv-lite as it's a superset of euc-kr
      // This properly handles the extended range that causes C1 control chars
      const buffer = Buffer.from(bytes);
      return iconv.decode(buffer, 'cp949');
    } catch {
      // Fall through to TextDecoder
    }
  }

  // Use TextDecoder for other encodings or as fallback
  try {
    // Map cp949 to euc-kr for TextDecoder (best effort, not perfect)
    const textDecoderEncoding = enc === 'cp949' ? 'euc-kr' : enc;
    const decoder = new TextDecoder(textDecoderEncoding, { fatal: false });
    return decoder.decode(bytes);
  } catch {
    // Ultimate fallback: decode as latin1 (preserves all byte values)
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  }
}

/**
 * Try to decode bytes and check quality of the result
 */
export function tryDecodeWithQuality(
  bytes: Uint8Array,
  encoding: string
): { text: string; badChars: number; c1Chars: number; replacementChars: number } {
  const text = decodeBytes(bytes, encoding);
  const c1Chars = countC1ControlChars(text);
  const replacementChars = countReplacementChars(text);
  const badChars = c1Chars + replacementChars;

  return { text, badChars, c1Chars, replacementChars };
}

/**
 * Detect the best encoding for Korean GRF files by analyzing byte patterns
 * and comparing decoded results.
 *
 * This function:
 * 1. Checks if bytes contain non-ASCII characters
 * 2. Tries UTF-8 and CP949 decoding
 * 3. Compares quality (bad chars, C1 control chars)
 * 4. Returns the encoding with best quality
 */
export function detectBestKoreanEncoding(
  sampleBytes: Uint8Array[],
  threshold: number = 0.01
): 'utf-8' | 'cp949' {
  if (sampleBytes.length === 0) return 'utf-8';

  let utf8BadTotal = 0;
  let cp949BadTotal = 0;
  let totalBytes = 0;
  let samplesWithHighBytes = 0;

  for (const bytes of sampleBytes) {
    // Check if this sample has non-ASCII bytes
    const hasHighBytes = bytes.some(b => b > 0x7F);
    if (!hasHighBytes) continue;

    samplesWithHighBytes++;
    totalBytes += bytes.length;

    const utf8Result = tryDecodeWithQuality(bytes, 'utf-8');
    const cp949Result = tryDecodeWithQuality(bytes, 'cp949');

    utf8BadTotal += utf8Result.badChars;
    cp949BadTotal += cp949Result.badChars;
  }

  // If no high bytes found, it's pure ASCII - use UTF-8
  if (samplesWithHighBytes === 0) {
    return 'utf-8';
  }

  const utf8BadRatio = totalBytes > 0 ? utf8BadTotal / totalBytes : 0;
  const cp949BadRatio = totalBytes > 0 ? cp949BadTotal / totalBytes : 0;

  // If UTF-8 looks perfect, use it
  if (utf8BadRatio < threshold) {
    return 'utf-8';
  }

  // If CP949 produces fewer bad chars, use it
  if (cp949BadRatio < utf8BadRatio) {
    return 'cp949';
  }

  // Default to UTF-8
  return 'utf-8';
}
