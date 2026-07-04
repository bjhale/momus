// src/diff/pool.ts
import type { DiffResponse } from "./worker";

interface Pending {
  aPng: Uint8Array; bPng: Uint8Array; threshold: number;
  resolve: (r: DiffResponse) => void;
}

/** Fixed-size pool of diff workers. Round-trips one job per worker at a time. */
export class DiffPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Pending[] = [];
  private inFlight = new Map<Worker, Pending>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    const w = new Worker(new URL("./worker.ts", import.meta.url).href);
    w.onmessage = (e: MessageEvent<DiffResponse>) => {
      const job = this.inFlight.get(w);
      this.inFlight.delete(w);
      if (job) job.resolve(e.data);
      this.idle.push(w);
      this.pump();
    };
    w.onerror = () => {
      // Worker crashed: fail its in-flight job, respawn a replacement.
      const job = this.inFlight.get(w);
      this.inFlight.delete(w);
      if (job) job.resolve({ id: -1, ok: false, error: "diff worker crashed" });
      this.workers = this.workers.filter((x) => x !== w);
      w.terminate();
      this.spawn();
      this.pump();
    };
    this.workers.push(w);
    this.idle.push(w);
  }

  submit(aPng: Uint8Array, bPng: Uint8Array, threshold: number): Promise<DiffResponse> {
    return new Promise((resolve) => {
      this.queue.push({ aPng, bPng, threshold, resolve });
      this.pump();
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
    for (const w of this.workers) w.terminate();
    this.workers = []; this.idle = [];
  }
}
