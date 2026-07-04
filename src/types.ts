// src/types.ts

/** Raw PNG capture for one side of a comparison. */
export interface CaptureResult {
  ok: boolean;
  png?: Uint8Array;
  error?: string;
}

/** Result of diffing a captured pair. */
export interface DiffResult {
  width: number;
  height: number;
  diffPixels: number;
  diffScore: number;   // diffPixels / (width*height), 0..1
  diffPng: Uint8Array;
}

/** A fully processed comparison ready to persist. */
export interface ComparisonRecord {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
  devImage?: Uint8Array;
  prodImage?: Uint8Array;
  diffImage?: Uint8Array;
  width?: number;
  height?: number;
  diffPixels?: number;
  diffScore?: number;
  passed?: boolean;
  status: "ok" | "error";
  error?: string;
}
