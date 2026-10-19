// src/diff/worker.ts
import { diffPngs, type DiffOptions } from "./diff";
import type { Region } from "../types";

export interface DiffRequest { id: number; aPng: Uint8Array; bPng: Uint8Array; opts: DiffOptions }
export interface DiffResponse {
  id: number; ok: boolean;
  width?: number; height?: number; diffPixels?: number; diffScore?: number;
  diffPng?: Uint8Array; error?: string;
  aWidth?: number; aHeight?: number; bWidth?: number; bHeight?: number;
  regions?: Region[]; regionCount?: number;
}

declare const self: Worker;

self.onmessage = (e: MessageEvent<DiffRequest>) => {
  const { id, aPng, bPng, opts } = e.data;
  try {
    const res: DiffResponse = { id, ok: true, ...diffPngs(aPng, bPng, opts) };
    self.postMessage(res);
  } catch (err) {
    const res: DiffResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
