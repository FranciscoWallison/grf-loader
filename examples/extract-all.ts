import {GrfNode} from '../src/grf-node';
import {openSync, mkdirSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

async function main() {
  const [grfPath, outDir = 'output'] = process.argv.slice(2);
  if (!grfPath) {
    console.error(
      'Usage: ts-node examples/extract-all.ts <path/to.grf> [outputDir]'
    );
    process.exit(1);
  }

  const fd = openSync(grfPath, 'r');
  const grf = new GrfNode(fd);
  await grf.load();

  for (const [path, _] of grf.files) {
    const {data, error} = await grf.getFile(path);
    if (error || !data) {
      console.error(`Failed to extract ${path}: ${error}`);
      continue;
    }
    const dest = join(outDir, path);
    mkdirSync(dirname(dest), {recursive: true});
    writeFileSync(dest, Buffer.from(data));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
