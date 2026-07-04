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
  private closed = false;
  private respawns = 0;
  private degraded = false;

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
      if (this.closed) return;
      // Bound respawns so a broken worker module cannot storm-loop forever.
      this.respawns++;
      const cap = this.workers.length * 5 + 10;
      if (this.respawns > cap) {
        if (!this.degraded) {
          this.degraded = true;
          console.error("DiffPool degraded: diff worker respawn cap exceeded; not respawning further");
        }
        this.pump();
        return;
      }
      this.spawn();
      this.pump();
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
