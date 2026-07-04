// src/pipeline/verdict.ts
import { matchPath } from "../glob";
import type { ComparisonRecord } from "../types";

export interface Override { path: string; failScore: number }

export function resolveFailScore(path: string, globalFailScore: number, overrides: Override[]): number {
  for (const o of overrides) if (matchPath(path, o.path)) return o.failScore;
  return globalFailScore;
}

export function passed(diffScore: number, failScore: number): boolean {
  return diffScore <= failScore;
}

/** 0 = all ok+passed; 1 = any diff-fail or error status (spec §7). The CLI sets
 * exit code 2 separately for operational errors that prevent a run. */
export function exitCodeFor(records: ComparisonRecord[]): number {
  for (const r of records) {
    if (r.status === "error") return 1;
    if (r.passed === false) return 1;
  }
  return 0;
}
