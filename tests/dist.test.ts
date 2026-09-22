/**
 * The published builds, not the sources: dist/ must exist (`yarn build`, which CI runs before the tests).
 *
 * Each build is loaded the way its users load it -- ES module import, CommonJS require, and the global
 * script in a context with no Node (no require, Buffer, process or global) -- and opens a real archive.
 * Blob comes from node:buffer because Jest 26's environment does not expose the global one.
 */
import {Blob} from 'buffer';
import {spawnSync} from 'child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {pathToFileURL} from 'url';
import vm from 'vm';
import {buildGrf} from './helpers/grf-builder';

const dist = join(__dirname, '../dist');
const built = existsSync(join(dist, 'index.js'));
const describeBuilt = built ? describe : describe.skip;

// 똠 (0x8C63) and 웤 (0x9F70) exist only in CP949's extension, which Node's TextDecoder('euc-kr') lacks:
// they decode right only through iconv-lite.
const UHC_NAME = 'data\\texture\\똠양꿍\\웤.bmp';
const KSX_NAME = 'data\\texture\\유저인터페이스\\item.bmp';

let grfPath = '';

beforeAll(() => {
  if (!built) console.warn('dist/ not found - skipping the build tests. Run "yarn build" first.');
  grfPath = join(mkdtempSync(join(tmpdir(), 'grf-loader-dist-')), 'test.grf');
  writeFileSync(grfPath, buildGrf([
    {name: 'data\\ascii.txt', content: 'plain'},
    {name: UHC_NAME, content: 'uhc'},
    {name: KSX_NAME, content: 'ksx'},
  ]));
});

/** Open the archive with the given module and print what the tests look at. */
const probe = (load: string) => `
${load}
const {openSync} = await import('fs');
const grf = new GrfNode(openSync(${JSON.stringify(grfPath)}, 'r'));
await grf.load();
const file = await grf.getFile(${JSON.stringify(UHC_NAME)});
console.log(JSON.stringify({
  hasIconvLite: hasIconvLite(),
  encoding: grf.getDetectedEncoding(),
  names: grf.listFiles(),
  content: file.data ? new TextDecoder().decode(file.data) : file.error,
}));
`;

function run(script: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describeBuilt('builds', () => {
  const expected = {
    hasIconvLite: true,
    encoding: 'cp949',
    names: ['data\\ascii.txt', UHC_NAME, KSX_NAME],
    content: 'uhc',
  };

  it('ES module: loads iconv-lite and decodes CP949 extension syllables', () => {
    const url = pathToFileURL(join(dist, 'index.js')).href;
    expect(run(probe(`const {GrfNode, hasIconvLite} = await import(${JSON.stringify(url)});`))).toEqual(expected);
  });

  it('CommonJS: loads iconv-lite and decodes CP949 extension syllables', () => {
    const file = join(dist, 'index.cjs');
    const load = `const {createRequire} = await import('module');
const {GrfNode, hasIconvLite} = createRequire(import.meta.url)(${JSON.stringify(file)});`;
    expect(run(probe(load))).toEqual(expected);
  });

  it('global script: runs without Node and reads an archive from a Blob', async () => {
    /** FileReader over Blob.arrayBuffer: all GrfBrowser uses of it. */
    class FileReader {
      result: ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        blob.arrayBuffer().then(
          buffer => { this.result = buffer; this.onload?.(); },
          error => this.onerror?.(error)
        );
      }
    }
    const window: Record<string, any> = {Blob, FileReader, TextDecoder, console};
    window.window = window;
    window.self = window;
    vm.runInNewContext(readFileSync(join(dist, 'index.global.js'), 'utf8'), window);

    const {GrfBrowser, GrfNode, hasIconvLite} = window.GrfLoader;
    expect(GrfNode).toBeUndefined();
    expect(hasIconvLite()).toBe(false);

    const grf = new GrfBrowser(new Blob([readFileSync(grfPath)]));
    await grf.load();
    // Without iconv-lite, names go through TextDecoder('euc-kr'). In browsers that is windows-949 and has
    // the extension syllables too; Node's has only KS X 1001, so only that name is checked here.
    expect(grf.hasFile(KSX_NAME)).toBe(true);
    const file = await grf.getFile(KSX_NAME);
    expect(new TextDecoder().decode(file.data)).toBe('ksx');
  });
});
