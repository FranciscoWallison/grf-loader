const path = require('path');
const fs = require('fs');

const distPath = path.join(__dirname, '../dist');
const distExists = fs.existsSync(path.join(distPath, 'index.js'));

describe('package entry points', () => {
  beforeAll(() => {
    if (!distExists) {
      console.warn('dist/ not found - skipping export tests. Run "yarn build" first.');
    }
  });

  (distExists ? it : it.skip)('can be imported using ESM', async () => {
    const mod = await import('../dist/index.js');
    expect(mod.GrfBrowser).toBeDefined();
    expect(mod.GrfNode).toBeDefined();
  });

  (distExists ? it : it.skip)('can be required using CJS', () => {
    const mod = require('../dist/index.cjs');
    expect(mod.GrfBrowser).toBeDefined();
    expect(mod.GrfNode).toBeDefined();
  });
});