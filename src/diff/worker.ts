// src/diff/worker.ts
import { diffPngs } from "./diff";

export interface DiffRequest { id: number; aPng: Uint8Array; bPng: Uint8Array; threshold: number }
export interface DiffResponse {
  id: number; ok: boolean;
  width?: number; height?: number; diffPixels?: number; diffScore?: number;
  diffPng?: Uint8Array; error?: string;
}

declare const self: Worker;

self.onmessage = (e: MessageEvent<DiffRequest>) => {
  const { id, aPng, bPng, threshold } = e.data;
  try {
    const r = diffPngs(aPng, bPng, threshold);
    const res: DiffResponse = {
      id, ok: true, width: r.width, height: r.height,
      diffPixels: r.diffPixels, diffScore: r.diffScore, diffPng: r.diffPng,
    };
    self.postMessage(res);
  } catch (err) {
    const res: DiffResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
