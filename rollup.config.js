import typescript from '@rollup/plugin-typescript';
import {terser} from 'rollup-plugin-terser';

const {name} = require('./package.json');
const external = ['fs', 'path', 'pako', 'jdataview'];
const globals = {
  pako: 'pako',
  jdataview: 'jDataview',
  fs: 'fs'
};

const cjs = [
  {
    input: 'index.ts',
    output: {
      file: `dist/cjs/grf-loader.js`,
      sourcemap: true,
      format: 'cjs',
      esModule: false
    },
    external,
    plugins: [typescript()]
  },
  {
    input: 'index.ts',
    output: {
      file: `dist/cjs/grf-loader.min.js`,
      sourcemap: true,
      format: 'cjs'
    },
    external,
    plugins: [
      typescript(),
      terser({
        toplevel: true,
        compress: {
          unsafe: true
        }
      })
    ]
  }
];

const esm = [
  {
    input: 'index.ts',
    output: {file: `dist/esm/grf-loader.js`, sourcemap: true, format: 'esm'},
    external,
    plugins: [typescript()]
  }
];

const umd = [
  {
    input: 'index.ts',
    output: {
      file: `dist/umd/grf-loader.js`,
      sourcemap: true,
      format: 'umd',
      name: 'GrfLoader',
      globals
    },
    external,
    plugins: [typescript()]
  },
  {
    input: 'index.ts',
    output: {
      file: `dist/umd/grf-loader.min.js`,
      sourcemap: true,
      format: 'umd',
      name: 'GrfLoader',
      globals
    },
    external,
    plugins: [
      typescript(),
      terser({
        toplevel: true,
        compress: {
          unsafe: true
        }
      })
    ]
  }
];

module.exports = [...cjs, ...esm, ...umd];
