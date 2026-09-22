import {readFile} from 'fs/promises';
import {defineConfig} from 'tsup';
import type {Plugin} from 'esbuild';

/**
 * jdataview (only behind the deprecated getStreamReader) ships just its Node build, which takes the
 * global object from `this` and feature-tests `"Buffer" in global`. Bundled, `this` is undefined there,
 * so the test throws and the script does not load. Point it at globalThis instead.
 */
const jdataviewGlobal: Plugin = {
  name: 'jdataview-global',
  setup(build) {
    build.onLoad({filter: /jdataview[\\/]dist[\\/]node[\\/]jdataview\.js$/}, async args => {
      const source = await readFile(args.path, 'utf8');
      const patched = source.replace('var global = this;', 'var global = globalThis;');
      if (patched === source) throw new Error('jdataview changed: "var global = this;" not found');
      return {contents: patched, loader: 'js'};
    });
  },
};

export default defineConfig([
  // Node: GrfNode and GrfBrowser, CommonJS and ES modules. Dependencies stay external, so iconv-lite is
  // imported from node_modules like any other package.
  {
    entry: {index: 'src/index.ts'},
    format: ['cjs', 'esm'],
    platform: 'node',
    target: 'node18',
    dts: true,
    sourcemap: true,
    minify: true,
    clean: true,
  },
  // Browser, as an ES module for bundlers ("browser" export condition).
  {
    entry: {browser: 'src/browser.ts'},
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    minify: true,
    clean: false,
  },
  // Browser, as a script tag: window.GrfLoader. Dependencies are bundled in.
  {
    entry: {index: 'src/browser.ts'},
    format: ['iife'],
    platform: 'browser',
    globalName: 'GrfLoader',
    noExternal: [/.*/],
    esbuildPlugins: [jdataviewGlobal],
    sourcemap: true,
    minify: true,
    clean: false,
  },
]);
