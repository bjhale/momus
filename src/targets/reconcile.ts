// src/targets/reconcile.ts
import type { Job } from "../pipeline/run";
import type { BaselineImageRow } from "../store/db";
import { canonicalJson, expandViewports, type Target, type TargetSourceName } from "./target";

export interface ReconcileArgs {
  baseline: BaselineImageRow[];
  /** Each source that listed successfully, with its live targets. */
  live: Map<TargetSourceName, Target[]>;
  /** Each source that failed to list, with the reason. */
  failed: Map<TargetSourceName, string>;
  viewports: number[];
}

const key = (id: string, viewport: number) => `${id} ${viewport}`;

function fromTarget(t: Target, viewport: number): Job {
  return { targetId: t.id, source: t.source, label: t.label, path: t.path, viewport, devUrl: t.url.dev, prodUrl: t.url.prod };
}

/** Pure: decide what runPipeline does with each (target, viewport). The
 * statuses are RFC-0001's: added/removed are their own outcomes, never errors,
 * and a source that couldn't list yields one error rather than a removed row
 * per target (ADR-0022). */
export function reconcile(a: ReconcileArgs): Job[] {
  const liveById = new Map<string, Target>();
  const liveKeys = new Set<string>();
  for (const targets of a.live.values()) {
    for (const t of targets) {
      liveById.set(t.id, t);
      for (const v of expandViewports(t, a.viewports)) liveKeys.add(key(t.id, v));
    }
  }
  const baselineKeys = new Set(a.baseline.map((r) => key(r.targetId, r.viewport)));

  const jobs: Job[] = [];
  // Baseline order first, so a pages-only run lists jobs exactly as before.
  for (const row of a.baseline) {
    if (a.failed.has(row.source)) continue; // reported once, below
    const t = liveById.get(row.targetId);
    if (!t || !liveKeys.has(key(row.targetId, row.viewport))) {
      jobs.push({ targetId: row.targetId, source: row.source, label: row.label, path: row.path,
        viewport: row.viewport, devUrl: "", prodUrl: row.prodUrl, action: "removed" });
      continue;
    }
    const job = { ...fromTarget(t, row.viewport), prodUrl: row.prodUrl };
    if (canonicalJson(t.recipe) !== row.recipeJson) {
      // Per-target gate (ADR-0023): a changed recipe invalidates this target's
      // baseline only, not the whole run.
      jobs.push({ ...job, action: "error",
        error: "recipe changed since the baseline was captured; re-run `momus snapshot` to re-capture it" });
      continue;
    }
    jobs.push({ ...job, action: "compare" });
  }

  for (const targets of a.live.values()) {
    for (const t of targets) {
      for (const v of expandViewports(t, a.viewports)) {
        if (!baselineKeys.has(key(t.id, v))) jobs.push({ ...fromTarget(t, v), action: "added" });
      }
    }
  }

  for (const [name, message] of a.failed) {
    jobs.push({ targetId: `source:${name}`, source: name, label: `${name} source`, path: "",
      viewport: 0, devUrl: "", prodUrl: "", action: "error", error: `could not list ${name} targets: ${message}` });
  }
  return jobs;
}
