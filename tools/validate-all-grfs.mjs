#!/usr/bin/env node
/**
 * validate-all-grfs.mjs
 *
 * Valida TODOS os arquivos GRF em uma pasta:
 *  - Testa decodificação de nomes
 *  - Testa leitura real de arquivos
 *  - Gera relatório detalhado
 *
 * Uso:
 *  node tools/validate-all-grfs.mjs <pasta> [encoding=auto]
 *
 * Ex:
 *  node tools/validate-all-grfs.mjs D:\\GRFs auto
 *  node tools/validate-all-grfs.mjs ./resources cp949
 */

import { GrfNode } from "../dist/index.js";
import { openSync, closeSync, writeFileSync, readdirSync, statSync } from "fs";
import path from "path";
import iconv from "iconv-lite";

// ============================================================================
// Configuration
// ============================================================================

const grfFolder = process.argv[2];
const encodingRequested = process.argv[3] || "auto";
const MAX_READ_TESTS = 100; // Max files to actually read per GRF
const MAX_EXAMPLES = 20; // Max examples to store per category

if (!grfFolder) {
  console.error("Uso: node tools/validate-all-grfs.mjs <pasta> [encoding=auto]");
  console.error("");
  console.error("Exemplos:");
  console.error("  node tools/validate-all-grfs.mjs D:\\\\GRFs");
  console.error("  node tools/validate-all-grfs.mjs ./resources cp949");
  process.exit(1);
}

// ============================================================================
// Helpers
// ============================================================================

function findGrfFiles(folder) {
  const grfFiles = [];

  function scan(dir) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scan(fullPath);
          } else if (entry.toLowerCase().endsWith(".grf")) {
            grfFiles.push(fullPath);
          }
        } catch (e) {
          // Skip inaccessible files
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
  }

  scan(folder);
  return grfFiles;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function mapToObj(m) {
  if (!m || typeof m.entries !== "function") return m;
  return Object.fromEntries(m.entries());
}

function logProgress(current, total, message) {
  const pct = total ? ((current / total) * 100).toFixed(1) : "??";
  process.stdout.write(`\r[${pct}%] ${message}`.padEnd(100, " "));
}

// ============================================================================
// Validation Functions
// ============================================================================

async function validateGrf(grfPath, encoding) {
  const result = {
    path: grfPath,
    filename: path.basename(grfPath),
    size: 0,
    sizeFormatted: "",
    encoding: encoding,
    detectedEncoding: null,
    loadTime: 0,
    success: false,
    error: null,
    stats: null,
    validation: {
      totalFiles: 0,
      badUfffd: 0,
      badC1Control: 0,
      roundTripFail: 0,
      readTestsPassed: 0,
      readTestsFailed: 0,
    },
    examples: {
      badUfffd: [],
      badC1Control: [],
      roundTripFail: [],
      readFailed: [],
    },
  };

  let fd = null;

  try {
    const stat = statSync(grfPath);
    result.size = stat.size;
    result.sizeFormatted = formatBytes(stat.size);

    fd = openSync(grfPath, "r");
    const grf = new GrfNode(fd, { filenameEncoding: encoding });

    const loadStart = Date.now();
    await grf.load();
    result.loadTime = Date.now() - loadStart;

    const stats = grf.getStats?.() ?? {};
    if (stats.extensionStats) {
      stats.extensionStats = mapToObj(stats.extensionStats);
    }
    result.stats = stats;
    result.detectedEncoding = stats.detectedEncoding || encoding;
    result.validation.totalFiles = stats.fileCount || grf.files.size;

    const encodingUsed = result.detectedEncoding;

    // Validate all filenames
    let fileIndex = 0;
    const allFiles = Array.from(grf.files.keys());

    for (const filename of allFiles) {
      fileIndex++;

      // Check for U+FFFD (replacement character)
      if (filename.includes("\uFFFD")) {
        result.validation.badUfffd++;
        if (result.examples.badUfffd.length < MAX_EXAMPLES) {
          result.examples.badUfffd.push(filename);
        }
      }

      // Check for C1 control characters (U+0080-U+009F)
      let hasC1 = false;
      for (const char of filename) {
        const code = char.charCodeAt(0);
        if (code >= 0x80 && code <= 0x9F) {
          hasC1 = true;
          break;
        }
      }
      if (hasC1) {
        result.validation.badC1Control++;
        if (result.examples.badC1Control.length < MAX_EXAMPLES) {
          result.examples.badC1Control.push(filename);
        }
      }

      // Round-trip test
      try {
        const encoded = iconv.encode(filename, encodingUsed);
        const decoded = iconv.decode(encoded, encodingUsed);
        if (decoded !== filename) {
          result.validation.roundTripFail++;
          if (result.examples.roundTripFail.length < MAX_EXAMPLES) {
            result.examples.roundTripFail.push({
              original: filename,
              roundTrip: decoded,
            });
          }
        }
      } catch (e) {
        result.validation.roundTripFail++;
      }
    }

    // Actually read some files to verify extraction works
    const filesToTest = allFiles.slice(0, MAX_READ_TESTS);
    for (let i = 0; i < filesToTest.length; i++) {
      const filename = filesToTest[i];
      if (i % 10 === 0) {
        logProgress(i, filesToTest.length, `Testing reads for ${result.filename}...`);
      }

      try {
        const fileResult = await grf.getFile(filename);
        if (fileResult.data && fileResult.data.length > 0) {
          result.validation.readTestsPassed++;
        } else if (fileResult.error) {
          result.validation.readTestsFailed++;
          if (result.examples.readFailed.length < MAX_EXAMPLES) {
            result.examples.readFailed.push({
              filename,
              error: fileResult.error,
            });
          }
        }
      } catch (e) {
        result.validation.readTestsFailed++;
        if (result.examples.readFailed.length < MAX_EXAMPLES) {
          result.examples.readFailed.push({
            filename,
            error: String(e?.message || e),
          });
        }
      }
    }

    result.success = true;

  } catch (e) {
    result.success = false;
    result.error = String(e?.message || e);
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (e) {
        // Ignore close errors
      }
    }
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=".repeat(80));
  console.log("GRF Validation Tool");
  console.log("=".repeat(80));
  console.log(`Folder: ${path.resolve(grfFolder)}`);
  console.log(`Encoding: ${encodingRequested}`);
  console.log("");

  // Find all GRF files
  console.log("[1] Scanning for GRF files...");
  const grfFiles = findGrfFiles(grfFolder);

  if (grfFiles.length === 0) {
    console.error("No GRF files found!");
    process.exit(1);
  }

  console.log(`    Found ${grfFiles.length} GRF file(s)`);
  console.log("");

  // Validate each GRF
  const report = {
    meta: {
      folder: path.resolve(grfFolder),
      encoding: encodingRequested,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      grfCount: grfFiles.length,
    },
    summary: {
      totalGrfs: grfFiles.length,
      successfulLoads: 0,
      failedLoads: 0,
      totalFiles: 0,
      totalBadUfffd: 0,
      totalBadC1Control: 0,
      totalRoundTripFail: 0,
      totalReadTestsPassed: 0,
      totalReadTestsFailed: 0,
    },
    grfs: [],
  };

  console.log("[2] Validating GRF files...");
  console.log("");

  for (let i = 0; i < grfFiles.length; i++) {
    const grfPath = grfFiles[i];
    const grfName = path.basename(grfPath);

    console.log(`[${i + 1}/${grfFiles.length}] ${grfName}`);

    const result = await validateGrf(grfPath, encodingRequested);
    report.grfs.push(result);

    if (result.success) {
      report.summary.successfulLoads++;
      report.summary.totalFiles += result.validation.totalFiles;
      report.summary.totalBadUfffd += result.validation.badUfffd;
      report.summary.totalBadC1Control += result.validation.badC1Control;
      report.summary.totalRoundTripFail += result.validation.roundTripFail;
      report.summary.totalReadTestsPassed += result.validation.readTestsPassed;
      report.summary.totalReadTestsFailed += result.validation.readTestsFailed;

      console.log(`    ✅ Loaded: ${result.validation.totalFiles} files, ` +
                  `${result.loadTime}ms, ` +
                  `encoding=${result.detectedEncoding}`);
      console.log(`       Bad: U+FFFD=${result.validation.badUfffd}, ` +
                  `C1=${result.validation.badC1Control}, ` +
                  `RoundTrip=${result.validation.roundTripFail}`);
      console.log(`       Read tests: ${result.validation.readTestsPassed} passed, ` +
                  `${result.validation.readTestsFailed} failed`);
    } else {
      report.summary.failedLoads++;
      console.log(`    ❌ Failed: ${result.error}`);
    }
    console.log("");
  }

  report.meta.finishedAt = new Date().toISOString();

  // Print summary
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`GRFs loaded:        ${report.summary.successfulLoads}/${report.summary.totalGrfs}`);
  console.log(`Total files:        ${report.summary.totalFiles.toLocaleString()}`);
  console.log(`Bad U+FFFD:         ${report.summary.totalBadUfffd.toLocaleString()}`);
  console.log(`Bad C1 Control:     ${report.summary.totalBadC1Control.toLocaleString()}`);
  console.log(`Round-trip fails:   ${report.summary.totalRoundTripFail.toLocaleString()}`);
  console.log(`Read tests passed:  ${report.summary.totalReadTestsPassed.toLocaleString()}`);
  console.log(`Read tests failed:  ${report.summary.totalReadTestsFailed.toLocaleString()}`);
  console.log("");

  // Calculate health score
  const totalBad = report.summary.totalBadUfffd + report.summary.totalBadC1Control;
  const healthPct = report.summary.totalFiles > 0
    ? ((report.summary.totalFiles - totalBad) / report.summary.totalFiles * 100).toFixed(2)
    : 0;

  console.log(`Encoding Health:    ${healthPct}% (${report.summary.totalFiles - totalBad}/${report.summary.totalFiles} clean)`);

  // Save report
  const outName = `grf-validation-${stamp()}.json`;
  const outPath = path.join(process.cwd(), outName);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log("");
  console.log(`Report saved: ${outPath}`);

  // Exit code
  if (report.summary.failedLoads > 0) {
    console.log("\n❌ Some GRFs failed to load");
    process.exit(2);
  } else if (totalBad > 0) {
    console.log("\n⚠️  Some encoding issues detected");
    process.exit(0);
  } else {
    console.log("\n✅ All validations passed");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
