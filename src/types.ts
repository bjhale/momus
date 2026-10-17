// src/types.ts
import type { TargetSourceName } from "./targets/target";

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

/** `added`/`removed`: the target is in only one of the live list and the
 * baseline (RFC-0001, ADR-0022). Never an error; never a silent pass. */
export type ComparisonStatus = "ok" | "error" | "added" | "removed";

/** A fully processed comparison ready to persist. */
export interface ComparisonRecord {
  /** Target identity. Omitted fields mean a page: id = label = path, source = pages. */
  targetId?: string;
  source?: TargetSourceName;
  label?: string;
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
  /** The failScore that applied (after per-path overrides). Set on compared
   * rows only; stored so an old run re-renders with its own gate. */
  failScore?: number;
  passed?: boolean;
  status: ComparisonStatus;
  error?: string;
}
