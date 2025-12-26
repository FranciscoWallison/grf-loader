import { openSync, closeSync } from 'fs';
import { performance } from 'perf_hooks';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GrfNode } from '../src/grf-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║              GRF LOADER - ADVANCED PERFORMANCE TESTS                      ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const grfPath = resolve(__dirname, '../data/with-files.grf');

// ============================================================================
// TEST 1: Cache Effectiveness
// ============================================================================
async function testCache() {
  console.log('📊 TEST 1: Cache Effectiveness\n');

  const fd = openSync(grfPath, 'r');
  const grf = new GrfNode(fd);
  await grf.load();

  // First extraction (cache miss)
  const start1 = performance.now();
  for (let i = 0; i < 100; i++) {
    await grf.getFile('full-des-compressed.txt');
  }
  const time1 = performance.now() - start1;

  // Second extraction (should hit cache)
  const start2 = performance.now();
  for (let i = 0; i < 100; i++) {
    await grf.getFile('full-des-compressed.txt');
  }
  const time2 = performance.now() - start2;

  console.log(`   ├─ 100x extraction (first time): ${time1.toFixed(2)}ms`);
  console.log(`   ├─ 100x extraction (cached):     ${time2.toFixed(2)}ms`);
  console.log(`   ├─ Speedup: ${(time1 / time2).toFixed(2)}x`);
  console.log(`   └─ Cache hit rate: ${(((time1 - time2) / time1) * 100).toFixed(1)}%\n`);

  closeSync(fd);
}

// ============================================================================
// TEST 2: Concurrent Extraction
// ============================================================================
async function testConcurrent() {
  console.log('📊 TEST 2: Concurrent vs Sequential Extraction\n');

  const fd = openSync(grfPath, 'r');
  const grf = new GrfNode(fd);
  await grf.load();

  const files = Array.from(grf.files.keys());

  // Sequential
  const start1 = performance.now();
  for (const file of files) {
    await grf.getFile(file);
  }
  const timeSeq = performance.now() - start1;

  // Clear cache for fair comparison
  grf.clearCache();

  // Concurrent
  const start2 = performance.now();
  await Promise.all(files.map(file => grf.getFile(file)));
  const timeCon = performance.now() - start2;

  console.log(`   ├─ Sequential (${files.length} files): ${timeSeq.toFixed(2)}ms`);
  console.log(`   ├─ Concurrent (${files.length} files): ${timeCon.toFixed(2)}ms`);
  console.log(`   └─ Speedup: ${(timeSeq / timeCon).toFixed(2)}x\n`);

  closeSync(fd);
}

// ============================================================================
// TEST 3: Buffer Pool Impact
// ============================================================================
async function testBufferPool() {
  console.log('📊 TEST 3: Buffer Pool Impact\n');

  const iterations = 100;

  // With buffer pool
  const fd1 = openSync(grfPath, 'r');
  const grfWithPool = new GrfNode(fd1, { useBufferPool: true });
  await grfWithPool.load();

  if (global.gc) global.gc();
  const memBefore1 = process.memoryUsage().heapUsed;
  const start1 = performance.now();

  for (let i = 0; i < iterations; i++) {
    await grfWithPool.getFile('full-des-compressed.txt');
    grfWithPool.clearCache(); // Prevent cache from affecting test
  }

  const time1 = performance.now() - start1;
  const memAfter1 = process.memoryUsage().heapUsed;

  closeSync(fd1);

  // Without buffer pool
  const fd2 = openSync(grfPath, 'r');
  const grfWithoutPool = new GrfNode(fd2, { useBufferPool: false });
  await grfWithoutPool.load();

  if (global.gc) global.gc();
  const memBefore2 = process.memoryUsage().heapUsed;
  const start2 = performance.now();

  for (let i = 0; i < iterations; i++) {
    await grfWithoutPool.getFile('full-des-compressed.txt');
    grfWithoutPool.clearCache();
  }

  const time2 = performance.now() - start2;
  const memAfter2 = process.memoryUsage().heapUsed;

  closeSync(fd2);

  console.log(`   ├─ WITH buffer pool:`);
  console.log(`   │  ├─ Time: ${time1.toFixed(2)}ms`);
  console.log(`   │  └─ Memory: ${((memAfter1 - memBefore1) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   ├─ WITHOUT buffer pool:`);
  console.log(`   │  ├─ Time: ${time2.toFixed(2)}ms`);
  console.log(`   │  └─ Memory: ${((memAfter2 - memBefore2) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   └─ Pool speedup: ${(time2 / time1).toFixed(2)}x\n`);
}

// ============================================================================
// TEST 4: Memory Usage Under Load
// ============================================================================
async function testMemory() {
  console.log('📊 TEST 4: Memory Usage Profile\n');

  const fd = openSync(grfPath, 'r');
  const grf = new GrfNode(fd);

  if (global.gc) global.gc();
  const memStart = process.memoryUsage();

  await grf.load();
  const memAfterLoad = process.memoryUsage();

  // Extract all files
  const files = Array.from(grf.files.keys());
  for (const file of files) {
    await grf.getFile(file);
  }
  const memAfterExtract = process.memoryUsage();

  // Clear cache
  grf.clearCache();
  if (global.gc) global.gc();
  const memAfterClear = process.memoryUsage();

  console.log(`   ├─ Initial:         ${(memStart.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   ├─ After load:      ${(memAfterLoad.heapUsed / 1024 / 1024).toFixed(2)} MB (+${((memAfterLoad.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   ├─ After extract:   ${(memAfterExtract.heapUsed / 1024 / 1024).toFixed(2)} MB (+${((memAfterExtract.heapUsed - memAfterLoad.heapUsed) / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`   └─ After clearCache:${(memAfterClear.heapUsed / 1024 / 1024).toFixed(2)} MB (${((memAfterClear.heapUsed - memAfterExtract.heapUsed) / 1024 / 1024).toFixed(2)} MB freed)\n`);

  closeSync(fd);
}

// ============================================================================
// TEST 5: TextDecoder vs String.fromCharCode
// ============================================================================
async function testTextDecoder() {
  console.log('📊 TEST 5: String Parsing Performance\n');

  const testString = 'data\\items\\equipments\\weapons\\sword.bmp';
  const testBytes = new Uint8Array(Buffer.from(testString, 'utf-8'));
  const iterations = 100000;

  // TextDecoder
  const decoder = new TextDecoder('utf-8');
  const start1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    decoder.decode(testBytes);
  }
  const time1 = performance.now() - start1;

  // String.fromCharCode (old method)
  const start2 = performance.now();
  for (let i = 0; i < iterations; i++) {
    let str = '';
    for (let j = 0; j < testBytes.length; j++) {
      str += String.fromCharCode(testBytes[j]);
    }
  }
  const time2 = performance.now() - start2;

  console.log(`   ├─ TextDecoder:         ${time1.toFixed(2)}ms (${(iterations / time1).toFixed(0)} ops/ms)`);
  console.log(`   ├─ String.fromCharCode: ${time2.toFixed(2)}ms (${(iterations / time2).toFixed(0)} ops/ms)`);
  console.log(`   └─ Speedup: ${(time2 / time1).toFixed(2)}x\n`);
}

// Run all tests
async function runTests() {
  try {
    await testCache();
    await testConcurrent();
    await testBufferPool();
    await testMemory();
    await testTextDecoder();

    console.log('✅ All advanced tests completed!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
