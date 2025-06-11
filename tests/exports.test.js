describe('package entry points', () => {
  it('can be imported using ESM', async () => {
    const mod = await import('../dist/esm/grf-loader.js');
    expect(mod.GrfBrowser).toBeDefined();
  });

  it('can be required using CJS', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../dist/cjs/grf-loader.cjs');
    expect(mod.GrfBrowser).toBeDefined();
  });
});
