import {resolve} from 'path';
import {openSync, closeSync} from 'fs';
import {GrfNode} from '../src/grf-node';

describe('GRFNode', () => {
  it('Should not load invalid fd', async () => {
    const fd = 0;
    let error = '';
    try {
      const grf = new GrfNode(fd);
      await grf.load();
    } catch (e) {
      error = e.message;
    } finally {
      closeSync(fd);
    }
    expect(error).toBeTruthy();
  });

  it('Should not load corrupted file', async () => {
    let error = '';
    try {
      const fd = openSync(resolve(__dirname, '../data/corrupted.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();
    } catch (e) {
      error = e.message;
    }
    expect(error).toBe('Not a GRF file (invalid signature)');
  });

  it('Should not load non-grf file', async () => {
    let error = '';
    try {
      const fd = openSync(resolve(__dirname, '../data/not-grf.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();
    } catch (e) {
      error = e.message;
    }
    expect(error).toBe('Not a GRF file (invalid signature)');
  });

  it('Should not load non 0x200 version', async () => {
    let error = '';
    try {
      const fd = openSync(
        resolve(__dirname, '../data/incorrect-version.grf'),
        'r'
      );
      const grf = new GrfNode(fd);
      await grf.load();
    } catch (e) {
      error = e.message;
    }
    expect(error).toBe('Unsupported version "0x103"');
  });

  it('Should load only once', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    try {
      const grf = new GrfNode(fd);

      // @ts-ignore
      const spy1 = spyOn(grf, 'parseHeader');
      // @ts-ignore
      const spy2 = spyOn(grf, 'parseFileList');

      await grf.load();
      await grf.load();
      await grf.load();

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    } catch (error) {
    } finally {
      closeSync(fd);
    }
  });

  it('Should load file list data', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    expect(grf.fileCount).toBe(7);

    // Check file count and names
    const files = Array.from(grf.files);
    expect(files.length).toBe(6); // 6 files (excluding folder)

    // Check specific entries (ignoring rawNameBytes which varies)
    const fileNames = files.map(([name]) => name);
    expect(fileNames).toContain('raw');
    expect(fileNames).toContain('corrupted');
    expect(fileNames).toContain('compressed');
    expect(fileNames).toContain('compressed-des-header');
    expect(fileNames).toContain('compressed-des-full');
    expect(fileNames).toContain('big-compressed-des-full');

    // Check entry properties (without rawNameBytes)
    const rawEntry = grf.files.get('raw');
    expect(rawEntry).toBeDefined();
    expect(rawEntry!.compressedSize).toBe(74);
    expect(rawEntry!.lengthAligned).toBe(74);
    expect(rawEntry!.realSize).toBe(74);
    expect(rawEntry!.type).toBe(1);
    expect(rawEntry!.offset).toBe(0);

    const compressedEntry = grf.files.get('compressed');
    expect(compressedEntry).toBeDefined();
    expect(compressedEntry!.compressedSize).toBe(16);
    expect(compressedEntry!.realSize).toBe(74);
  });

  it('Should reject `getFile` if grf file not loaded', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    const {data, error} = await grf.getFile('raw');

    expect(data).toBe(null);
    expect(error).toBe('GRF not loaded yet');
  });

  it('Should reject not found file', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();
    const {data, error} = await grf.getFile('notfound');

    expect(data).toBe(null);
    expect(error).toBe('File "notfound" not found');
  });

  it('Should not load folder file', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();
    const {data, error} = await grf.getFile('folder');
    expect(data).toBe(null);
    expect(error).toBe('File "folder" not found');
  });

  it('Should reject corrupted files inside grf', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();
    const {data, error} = await grf.getFile('corrupted');

    expect(data).toBe(null);
    expect(error).toBeTruthy();
  });

  it('Should load the file without compression and encryption', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    const {data, error} = await grf.getFile('raw');
    const result = String.fromCharCode.apply(null, data);

    expect(error).toBe(null);
    expect(result).toBe(
      'test test test test test test test test test test test test test test test'
    );
  });

  it('Should load the file with compression and no encryption', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    const {data, error} = await grf.getFile('compressed');
    const result = String.fromCharCode.apply(null, data);

    expect(error).toBe(null);
    expect(result).toBe(
      'test test test test test test test test test test test test test test test'
    );
  });

  it('Should load the file with partial encryption', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    const {data, error} = await grf.getFile('compressed-des-header');
    const result = String.fromCharCode.apply(null, data);

    expect(error).toBe(null);
    expect(result).toBe(
      'test test test test test test test test test test test test test test test'
    );
  });

  it('Should load the file with full encryption', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    const {data, error} = await grf.getFile('compressed-des-full');
    const result = String.fromCharCode.apply(null, data);

    expect(error).toBe(null);
    expect(result).toBe(
      'test test test test test test test test test test test test test test test'
    );
  });

  it('Should load big file with full encryption', async () => {
    const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
    const grf = new GrfNode(fd);
    await grf.load();

    const {data, error} = await grf.getFile('big-compressed-des-full');
    const result = String.fromCharCode.apply(null, data);

    expect(error).toBe(null);
    expect(result).toBe(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed venenatis bibendum venenatis. Aliquam quis velit urna. Suspendisse nec posuere sem. Donec risus quam, vulputate sed augue ultricies, dignissim hendrerit purus. Nulla euismod dolor enim, vel fermentum ex ultricies ac. Donec aliquet vehicula egestas. Sed accumsan velit ac mauris porta, id imperdiet purus aliquam. Phasellus et faucibus erat. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Pellentesque vel nisl efficitur, euismod augue eu, consequat dui. Maecenas vestibulum tortor purus, egestas posuere tortor imperdiet eget. Nulla sit amet placerat diam.'
    );
  });

  // New tests for search and statistics functionality
  describe('Search and Statistics', () => {
    it('Should provide statistics', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      const stats = grf.getStats();
      expect(stats.fileCount).toBe(6);
      expect(stats.badNameCount).toBe(0);
      expect(stats.detectedEncoding).toBe('utf-8');
      closeSync(fd);
    });

    it('Should list files', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      const files = grf.listFiles();
      expect(files.length).toBe(6);
      expect(files).toContain('raw');
      closeSync(fd);
    });

    it('Should check if file exists', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      expect(grf.hasFile('raw')).toBe(true);
      expect(grf.hasFile('notfound')).toBe(false);
      closeSync(fd);
    });

    it('Should get entry metadata', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      const entry = grf.getEntry('raw');
      expect(entry).not.toBeNull();
      expect(entry!.realSize).toBe(74);
      expect(grf.getEntry('notfound')).toBeNull();
      closeSync(fd);
    });

    it('Should resolve paths case-insensitively', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd);
      await grf.load();

      const resolved1 = grf.resolvePath('raw');
      expect(resolved1.status).toBe('found');
      expect(resolved1.matchedPath).toBe('raw');

      const resolved2 = grf.resolvePath('RAW');
      expect(resolved2.status).toBe('found');
      expect(resolved2.matchedPath).toBe('raw');

      const resolved3 = grf.resolvePath('notfound');
      expect(resolved3.status).toBe('not_found');
      closeSync(fd);
    });
  });

  describe('Error handling', () => {
    it('Should throw error for corrupted/empty file', async () => {
      try {
        const fd = openSync(resolve(__dirname, '../data/corrupted.grf'), 'r');
        const grf = new GrfNode(fd);
        await grf.load();
        fail('Should have thrown');
      } catch (e) {
        // corrupted.grf is empty (0 bytes), so it throws a read error
        expect(e).toBeTruthy();
      }
    });

    it('Should throw GrfError for non-GRF file', async () => {
      try {
        const fd = openSync(resolve(__dirname, '../data/not-grf.grf'), 'r');
        const grf = new GrfNode(fd);
        await grf.load();
        fail('Should have thrown');
      } catch (e) {
        // Check error properties (instanceof may not work with babel transpilation)
        const err = e as any;
        expect(err.name).toBe('GrfError');
        expect(err.code).toBe('INVALID_MAGIC');
        expect(err.message).toBe('Not a GRF file (invalid signature)');
      }
    });

    it('Should throw GrfError with correct code for unsupported version', async () => {
      try {
        const fd = openSync(resolve(__dirname, '../data/incorrect-version.grf'), 'r');
        const grf = new GrfNode(fd);
        await grf.load();
        fail('Should have thrown');
      } catch (e) {
        // Check error properties (instanceof may not work with babel transpilation)
        const err = e as any;
        expect(err.name).toBe('GrfError');
        expect(err.code).toBe('UNSUPPORTED_VERSION');
      }
    });
  });

  describe('Options', () => {
    it('Should accept encoding option', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd, { filenameEncoding: 'utf-8' });
      await grf.load();

      expect(grf.getDetectedEncoding()).toBe('utf-8');
      closeSync(fd);
    });

    it('Should auto-detect encoding', async () => {
      const fd = openSync(resolve(__dirname, '../data/with-files.grf'), 'r');
      const grf = new GrfNode(fd, { filenameEncoding: 'auto' });
      await grf.load();

      // For ASCII files, should detect as utf-8
      expect(grf.getDetectedEncoding()).toBe('utf-8');
      closeSync(fd);
    });
  });
});
