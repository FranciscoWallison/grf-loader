export {GrfBrowser} from './grf-browser';
export {GrfNode, GrfNodeOptions} from './grf-node';
export type {
  TFileEntry,
  FilenameEncoding,
  GrfOptions,
  FindOptions,
  ResolveResult,
  GrfStats
} from './grf-base';
export {GrfError, GRF_ERROR_CODES} from './grf-base';
export {bufferPool} from './buffer-pool';

// Encoding utilities
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
