import { openSync, closeSync } from 'fs';
import { performance } from 'perf_hooks';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GrfNode } from '../src/grf-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BenchmarkResult {
  name: string;
  duration: number;
  iterations: number;
  avgTime: number;
  opsPerSec: number;
  memoryUsed?: number;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async benchmark(
    name: string,
    fn: () => Promise<void>,
    iterations: number = 100
  ): Promise<BenchmarkResult> {
    // Warmup
    await fn();

    // Force GC if available
    if (global.gc) {
      global.gc();
    }

    const memBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await fn();
    }

    const endTime = performance.now();
    const memAfter = process.memoryUsage().heapUsed;

    const duration = endTime - startTime;
    const avgTime = duration / iterations;
    const opsPerSec = 1000 / avgTime;
    const memoryUsed = memAfter - memBefore;

    const result: BenchmarkResult = {
      name,
      duration,
      iterations,
      avgTime,
      opsPerSec,
      memoryUsed
    };

    this.results.push(result);
    return result;
  }

  printResults(): void {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    GRF LOADER - PERFORMANCE BENCHMARK                     ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

    this.results.forEach((result) => {
      console.log(`📊 ${result.name}`);
      console.log(`   ├─ Total time: ${result.duration.toFixed(2)}ms`);
      console.log(`   ├─ Iterations: ${result.iterations}`);
      console.log(`   ├─ Average: ${result.avgTime.toFixed(2)}ms/op`);
      console.log(`   ├─ Throughput: ${result.opsPerSec.toFixed(2)} ops/sec`);
      if (result.memoryUsed !== undefined) {
        console.log(`   └─ Memory: ${(result.memoryUsed / 1024 / 1024).toFixed(2)} MB\n`);
      }
    });
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }
}

async function runBenchmarks() {
  const bench = new PerformanceBenchmark();
  const grfPath = resolve(__dirname, '../data/with-files.grf');

  console.log('🚀 Starting GRF Loader benchmarks...\n');
  console.log(`📁 Test file: ${grfPath}\n`);

  // Benchmark 1: Load GRF file
  await bench.benchmark(
    'Load GRF file',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();
      closeSync(fd);
    },
    50
  );

  // Benchmark 2: Extract single uncompressed file
  await bench.benchmark(
    'Extract uncompressed file (raw.txt)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();
      await grf.getFile('raw.txt');
      closeSync(fd);
    },
    50
  );

  // Benchmark 3: Extract compressed file
  await bench.benchmark(
    'Extract compressed file (compressed.txt)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();
      await grf.getFile('compressed.txt');
      closeSync(fd);
    },
    50
  );

  // Benchmark 4: Extract encrypted file (header only)
  await bench.benchmark(
    'Extract header-encrypted file (partial-des.txt)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();
      await grf.getFile('partial-des.txt');
      closeSync(fd);
    },
    50
  );

  // Benchmark 5: Extract fully encrypted file
  await bench.benchmark(
    'Extract fully-encrypted file (full-des-compressed.txt)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();
      await grf.getFile('full-des-compressed.txt');
      closeSync(fd);
    },
    50
  );

  // Benchmark 6: Extract all files
  await bench.benchmark(
    'Extract ALL files (7 files)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      const fileList = Array.from(grf.files.keys());
      for (const filename of fileList) {
        await grf.getFile(filename);
      }

      closeSync(fd);
    },
    20
  );

  // Benchmark 7: Repeated extraction (cache test)
  await bench.benchmark(
    'Repeated extraction (10x same file)',
    async () => {
      const fd = openSync(grfPath, 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      for (let i = 0; i < 10; i++) {
        await grf.getFile('full-des-compressed.txt');
      }

      closeSync(fd);
    },
    20
  );

  bench.printResults();

  // Save results to JSON
  const fs = await import('fs/promises');
  await fs.writeFile(
    resolve(__dirname, 'benchmark-results.json'),
    JSON.stringify(bench.getResults(), null, 2)
  );

  console.log('💾 Results saved to benchmark/benchmark-results.json\n');
}

// Run benchmarks
runBenchmarks().catch(console.error);
