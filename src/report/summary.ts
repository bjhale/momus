// src/report/summary.ts
import type { ComparisonRecord } from "../types";

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  verdict: "PASS" | "FAIL";
  /** Highest-diffScore ok comparison; omitted when there are no ok comparisons. */
  worst?: { path: string; viewport: number; pct: string };
  viewports: number[];
}

/** Per-item status class used by both styling and the filter. */
export function itemClass(r: ComparisonRecord): "pass" | "fail" | "error" {
  if (r.status === "error") return "error";
  return r.passed ? "pass" : "fail";
}

export function summarize(records: ComparisonRecord[]): ReportSummary {
  let passed = 0, failed = 0, errored = 0;
  let worst: ReportSummary["worst"];
  let worstScore = -1;

  for (const r of records) {
    if (r.status === "error") { errored++; continue; }
    if (r.passed) passed++; else failed++;
    const score = r.diffScore ?? 0;
    if (score > worstScore) {
      worstScore = score;
      worst = { path: r.path, viewport: r.viewport, pct: (score * 100).toFixed(2) };
    }
  }

  const viewports = [...new Set(records.map((r) => r.viewport))].sort((a, b) => a - b);
  return {
    total: records.length,
    passed, failed, errored,
    verdict: failed === 0 && errored === 0 ? "PASS" : "FAIL",
    worst, viewports,
  };
}
