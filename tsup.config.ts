import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: {
      entry: 'src/index.ts',
      outDir: 'dist/types'
    },
    outDir: 'dist/esm',
    sourcemap: true,
    minify: true,
    clean: true
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    outDir: 'dist/cjs',
    sourcemap: true,
    minify: true,
    clean: false,
    outExtension: () => ({ js: '.cjs' })
  },
  {
    entry: ['src/index.ts'],
    format: ['iife'],
    globalName: 'GrfLoader',
    outDir: 'dist/umd',
    sourcemap: true,
    minify: true,
    clean: false
  }
]);
