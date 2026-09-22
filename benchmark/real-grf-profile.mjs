/**
 * Where the time goes on a real archive.
 *
 *   yarn build
 *   node benchmark/real-grf-profile.mjs <path/to/data.grf> [path/to/another/index.cjs]
 *
 * Measures dist/index.cjs: load(), the lookup indexes, reading files spread over the archive, and the
 * event loop while the largest one is read. With a second build (an older published one, say
 * node_modules/@chicowall/grf-loader/dist/index.cjs) it runs the same numbers for it, side by side.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const resolve = (path) => require.resolve(path, { paths: [process.cwd()] });

const ms = (t) => `${(performance.now() - t).toFixed(0)} ms`;
const mib = (n) => `${(n / 2 ** 20).toFixed(0)} MiB`;

async function measure(label, grfPath, modulePath) {
  const { GrfNode } = require(modulePath);
  console.log(`\n== ${label}: ${modulePath}`);

  // load()
  const fd = fs.openSync(grfPath, 'r');
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  let t = performance.now();
  const grf = new GrfNode(fd);
  await grf.load();
  console.log(`  load()                                     ${ms(t)}  (${grf.files.size} files, ${grf.getDetectedEncoding()})`);
  console.log(`  heap held by the loaded archive            ${mib(process.memoryUsage().heapUsed - heapBefore)}`);

  // The indexes behind resolvePath/find/getStats, built on demand since 1.2.0.
  t = performance.now();
  grf.getStats();
  console.log(`  first getStats()                           ${ms(t)}`);

  // 2,000 compressed files spread over the archive, read one after another.
  const all = [...grf.files.entries()].filter(([, e]) => e.realSize !== e.compressedSize);
  const step = Math.max(1, Math.floor(all.length / 2000));
  const sample = all.filter((_, i) => i % step === 0).slice(0, 2000);
  const sampleBytes = sample.reduce((n, [, e]) => n + e.realSize, 0);
  // Read them once untimed: otherwise the first build to run pays for the reads from the disk and the
  // next one finds the same bytes in the operating system's cache.
  for (const [name] of sample) await grf.getFile(name);
  grf.clearCache();
  t = performance.now();
  for (const [name] of sample) await grf.getFile(name);
  console.log(`  getFile() x ${String(sample.length).padEnd(5)} (${mib(sampleBytes).padStart(8)} uncompressed)  ${ms(t)}`);

  // The largest file, and what the event loop does while it is read.
  const [biggestName, biggest] = all.reduce((a, b) => (b[1].realSize > a[1].realSize ? b : a));
  await grf.getFile(biggestName);
  grf.clearCache();
  const gaps = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
  }, 1);
  t = performance.now();
  await grf.getFile(biggestName);
  const took = ms(t);
  // A timer only fires once the microtasks are done, so the gap left by work on the main thread is only
  // recorded after giving the loop a turn.
  await new Promise((done) => setTimeout(done, 5));
  clearInterval(timer);
  console.log(`  getFile() of the largest (${mib(biggest.realSize)})          ${took}  (longest event-loop gap ${Math.max(...gaps).toFixed(0)} ms)`);

  fs.closeSync(fd);
}

// A child measures one build: `--build <label> <grf> <build>`.
if (process.argv[2] === '--build') {
  const [label, grf, build] = process.argv.slice(3);
  await measure(label, grf, build);
} else {
  const [grfPath, otherBuild] = process.argv.slice(2);
  if (!grfPath) {
    console.error('usage: node benchmark/real-grf-profile.mjs <path/to/data.grf> [path/to/another/index.cjs]');
    process.exit(1);
  }

  const builds = [['this build', require.resolve('../dist/index.cjs')]];
  if (otherBuild) builds.push(['other build', resolve(otherBuild)]);

  // Each build is measured in a process of its own: they share neither the heap nor a warmed-up JIT, and
  // whichever ran first would otherwise leave the archive in the operating system's cache for the other.
  console.log(`GRF: ${grfPath} (${(fs.statSync(grfPath).size / 2 ** 30).toFixed(2)} GiB)`);
  for (const [label, build] of builds) {
    const args = ['--expose-gc', fileURLToPath(import.meta.url), '--build', label, grfPath, build];
    const run = spawnSync(process.execPath, args, {stdio: 'inherit'});
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
