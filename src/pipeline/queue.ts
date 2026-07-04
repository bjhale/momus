// src/pipeline/queue.ts

/** Counting semaphore for bounding concurrency. */
export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    this.permits++;
    const next = this.waiters.shift();
    if (next) { this.permits--; next(); }
  }
}

/** Map over items with a bounded number of concurrent async calls, preserving
 * output order. Backpressure: at most `limit` fn() calls run at once. */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const sem = new Semaphore(limit);
  await Promise.all(items.map(async (item, i) => {
    await sem.acquire();
    try { results[i] = await fn(item, i); }
    finally { sem.release(); }
  }));
  return results;
}
