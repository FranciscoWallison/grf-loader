/**
 * Browser entry point: the global build (dist/index.global.js, `window.GrfLoader`) and the "browser"
 * export condition for bundlers.
 *
 * Only what runs in a browser: no GrfNode, nothing that needs Node's fs, zlib, Buffer or iconv-lite.
 * Korean names are decoded with TextDecoder, whose EUC-KR in browsers is windows-949 (the Encoding
 * Standard), so it covers CP949's extension syllables. The mojibake helpers need iconv-lite and return
 * their input unchanged here.
 */
export {GrfBrowser} from './grf-browser';
export type {
  TFileEntry,
  FilenameEncoding,
  GrfOptions,
  FindOptions,
  ResolveResult,
  GrfStats
} from './grf-base';
export {GrfError, GRF_ERROR_CODES} from './grf-base';

export {
  isMojibake,
  fixMojibake,
  toMojibake,
  normalizeFilename,
  normalizePath as normalizeEncodingPath,
  countBadChars,
  countC1ControlChars,
  countReplacementChars,
  hasIconvLite
} from './decoder';
