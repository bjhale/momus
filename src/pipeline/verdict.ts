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

/** Gate opt-outs for statuses that are changes to review, not failures to fix. */
export interface GateOptions { allowAdded: boolean; allowRemoved: boolean }
export const STRICT_GATE: GateOptions = { allowAdded: false, allowRemoved: false };

/** One rule for both the exit code and the report verdict, so they can't
 * disagree. An error always fails; the allow flags only cover added/removed. */
export function failsGate(r: ComparisonRecord, gate: GateOptions): boolean {
  if (r.status === "error") return true;
  if (r.status === "added") return !gate.allowAdded;
  if (r.status === "removed") return !gate.allowRemoved;
  // The baseline itself wasn't repeatable, so its diff can't be trusted
  // either way; it's shown for review, not counted (ADR-0034).
  if (r.status === "unstable") return false;
  return r.passed === false;
}

/** 0 = nothing fails the gate; 1 = a diff failure, an error, or an unallowed
 * added/removed target (spec §7). The CLI sets exit code 2 separately for
 * operational errors that prevent a run. */
export function exitCodeFor(records: ComparisonRecord[], gate: GateOptions = STRICT_GATE): number {
  return records.some((r) => failsGate(r, gate)) ? 1 : 0;
}
