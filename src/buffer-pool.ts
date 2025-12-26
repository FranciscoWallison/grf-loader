/**
 * Simple buffer pool for reducing GC pressure
 * Pools buffers of common sizes for reuse
 */

interface PoolEntry {
  buffer: Buffer;
  inUse: boolean;
}

class BufferPool {
  private pools = new Map<number, PoolEntry[]>();
  private maxPoolSize = 10;

  // Common buffer sizes to pool (in bytes)
  private readonly poolSizes = [
    1024,      // 1KB
    4096,      // 4KB
    8192,      // 8KB
    16384,     // 16KB
    32768,     // 32KB
    65536,     // 64KB
    131072,    // 128KB
    262144,    // 256KB
  ];

  constructor() {
    // Initialize pools for common sizes
    for (const size of this.poolSizes) {
      this.pools.set(size, []);
    }
  }

  /**
   * Get appropriate pool size for requested length
   */
  private getPoolSize(length: number): number | null {
    for (const size of this.poolSizes) {
      if (length <= size) {
        return size;
      }
    }
    return null; // Too large, don't pool
  }

  /**
   * Acquire a buffer from the pool or create new one
   */
  acquire(length: number): Buffer {
    const poolSize = this.getPoolSize(length);

    // Don't pool large buffers
    if (poolSize === null) {
      return Buffer.allocUnsafe(length);
    }

    const pool = this.pools.get(poolSize);

    if (pool) {
      // Try to find available buffer
      const available = pool.find(entry => !entry.inUse);

      if (available) {
        available.inUse = true;
        return available.buffer.subarray(0, length);
      }

      // Pool is full or all in use, create new if pool not maxed
      if (pool.length < this.maxPoolSize) {
        const buffer = Buffer.allocUnsafe(poolSize);
        pool.push({ buffer, inUse: true });
        return buffer.subarray(0, length);
      }
    }

    // Fallback: create non-pooled buffer
    return Buffer.allocUnsafe(length);
  }

  /**
   * Release a buffer back to the pool
   */
  release(buffer: Buffer): void {
    const actualSize = buffer.buffer.byteLength;
    const pool = this.pools.get(actualSize);

    if (pool) {
      const entry = pool.find(e => e.buffer === buffer || e.buffer.buffer === buffer.buffer);
      if (entry) {
        entry.inUse = false;
      }
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      pool.length = 0;
    }
  }

  /**
   * Get pool statistics
   */
  stats(): { size: number; total: number; inUse: number }[] {
    const stats: { size: number; total: number; inUse: number }[] = [];

    for (const [size, pool] of this.pools.entries()) {
      stats.push({
        size,
        total: pool.length,
        inUse: pool.filter(e => e.inUse).length
      });
    }

    return stats;
  }
}

// Export singleton instance
export const bufferPool = new BufferPool();
