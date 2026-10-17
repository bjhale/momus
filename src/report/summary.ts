// src/report/summary.ts
import { failsGate, STRICT_GATE, type GateOptions } from "../pipeline/verdict";
import type { ComparisonRecord } from "../types";

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  added: number;
  removed: number;
  verdict: "PASS" | "FAIL";
  /** Highest-diffScore ok comparison; omitted when there are no ok comparisons.
   * `path` carries the target's label. */
  worst?: { path: string; viewport: number; pct: string };
  viewports: number[];
}

/** Per-item status class used by both styling and the filter. */
export function itemClass(r: ComparisonRecord): "pass" | "fail" | "error" | "added" | "removed" {
  if (r.status === "error" || r.status === "added" || r.status === "removed") {
    return r.status;
  }
  return r.passed ? "pass" : "fail";
}

export function summarize(records: ComparisonRecord[], gate: GateOptions = STRICT_GATE): ReportSummary {
  let passed = 0, failed = 0, errored = 0, added = 0, removed = 0;
  let worst: ReportSummary["worst"];
  let worstScore = -1;

  for (const r of records) {
    if (r.status === "error") { errored++; continue; }
    if (r.status === "added") { added++; continue; }
    if (r.status === "removed") { removed++; continue; }
    if (r.passed) passed++; else failed++;
    const score = r.diffScore ?? 0;
    if (score > worstScore) {
      worstScore = score;
      worst = { path: r.label ?? r.path, viewport: r.viewport, pct: (score * 100).toFixed(2) };
    }
  }

  // Viewport 0 marks a source-level error row, which belongs to no width.
  const viewports = [...new Set(records.map((r) => r.viewport).filter((v) => v > 0))].sort((a, b) => a - b);
  return {
    total: records.length,
    passed, failed, errored, added, removed,
    verdict: records.some((r) => failsGate(r, gate)) ? "FAIL" : "PASS",
    worst, viewports,
  };
}
