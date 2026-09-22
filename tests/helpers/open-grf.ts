import {mkdtempSync, openSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {GrfNode, GrfNodeOptions} from '../../src/grf-node';
import {buildGrf, BuilderEntry} from './grf-builder';

/** Write the entries to a temporary .grf and open it with GrfNode, loaded. */
export async function openBuiltGrf(entries: BuilderEntry[], options?: GrfNodeOptions): Promise<GrfNode> {
  const file = join(mkdtempSync(join(tmpdir(), 'grf-loader-test-')), 'test.grf');
  writeFileSync(file, buildGrf(entries));
  const grf = new GrfNode(openSync(file, 'r'), options);
  await grf.load();
  return grf;
}
