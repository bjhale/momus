// src/diff/pool.ts
import type { DiffResponse } from "./worker";
import { diffPngs } from "./diff";

interface Pending {
  aPng: Uint8Array; bPng: Uint8Array; threshold: number;
  resolve: (r: DiffResponse) => void;
}

/** Fixed-size pool of diff workers. Round-trips one job per worker at a time.
 *
 * Workers are the fast path under `bun run`/tests. When a worker cannot be used
 * (e.g. a `bun build --compile` standalone binary can't resolve the worker
 * module out of the `/$bunfs` bundle), the pool permanently falls back to inline
 * main-thread diffing via the pure `diffPngs`, which is correct and fast. */
export class DiffPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Pending[] = [];
  private inFlight = new Map<Worker, Pending>();
  private nextId = 1;
  private closed = false;
  private inline = false;
  private workerUrl: string;

  constructor(size: number, workerUrl: string = new URL("./worker.ts", import.meta.url).href) {
    this.workerUrl = workerUrl;
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    let w: Worker;
    try {
      // In a compiled binary this can throw synchronously (module can't be
      // resolved out of /$bunfs) instead of firing onerror. Either way, fall
      // back to inline main-thread diffing.
      w = new Worker(this.workerUrl);
    } catch {
      this.inline = true;
      return;
    }
    w.onmessage = (e: MessageEvent<DiffResponse>) => {
      const job = this.inFlight.get(w);
      this.inFlight.delete(w);
      if (job) job.resolve(e.data);
      this.idle.push(w);
      this.pump();
    };
    w.onerror = () => {
      if (this.closed) { this.inFlight.delete(w); return; }
      // A worker error (usually a load failure inside the compiled binary) means
      // workers are unusable here. Switch to inline main-thread diffing
      // permanently, tear down the workers, and re-route every not-yet-resolved
      // job (this worker's in-flight job, any other in-flight jobs, and the
      // whole queue) to inline. Do NOT respawn — a worker that can't load never
      // will, and inline is always safe.
      this.inline = true;
      const orphans: Pending[] = [];
      for (const [, j] of this.inFlight) orphans.push(j);
      this.inFlight.clear();
      const queued = this.queue;
      this.queue = [];
      for (const x of this.workers) x.terminate();
      this.workers = [];
      this.idle = [];
      for (const j of orphans) this.runInline(j);
      for (const j of queued) this.runInline(j);
    };
    this.workers.push(w);
    this.idle.push(w);
  }

  submit(aPng: Uint8Array, bPng: Uint8Array, threshold: number): Promise<DiffResponse> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve({ id: -1, ok: false, error: "pool closed" });
        return;
      }
      const job: Pending = { aPng, bPng, threshold, resolve };
      if (this.inline) {
        this.runInline(job);
        return;
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Compute a job on the main thread, resolving with the worker's DiffResponse shape. */
  private runInline(job: Pending): void {
    // async so we never resolve synchronously inside submit()
    Promise.resolve().then(() => {
      try {
        const r = diffPngs(job.aPng, job.bPng, job.threshold);
        job.resolve({
          id: -1, ok: true, width: r.width, height: r.height,
          diffPixels: r.diffPixels, diffScore: r.diffScore, diffPng: r.diffPng,
        });
      } catch (err) {
        job.resolve({ id: -1, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.inFlight.set(w, job);
      w.postMessage({ id: this.nextId++, aPng: job.aPng, bPng: job.bPng, threshold: job.threshold });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    // terminate() fires no message/error events, so resolve pending work ourselves
    // to avoid leaking callers awaiting in-flight or queued jobs.
    for (const [, job] of this.inFlight) job.resolve({ id: -1, ok: false, error: "pool closed" });
    for (const job of this.queue) job.resolve({ id: -1, ok: false, error: "pool closed" });
    this.inFlight.clear();
    this.queue = [];
    for (const w of this.workers) w.terminate();
    this.workers = []; this.idle = [];
  }
}
