// src/pipeline/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import type { Progress } from "../progress";
import { clearBaseline, clearRuns, saveBaselineImage, writeSnapshot } from "../store/db";
import { mapWithConcurrency } from "./queue";
import { pagesSource } from "../targets/pages";
import { canonicalJson, checkTargetIds, expandViewports, type TargetSource } from "../targets/target";

export interface SnapshotPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  createdAt: string;
  /** Pages discovery: the `pages` source, which every project has. */
  discover: () => Promise<string[]>;
  /** Sources beyond pages. None ship yet (RFC-0004 scenarios, RFC-0005 storybook). */
  sources?: TargetSource[];
  captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  progress?: Progress;
}

/** Capture prod once into the baseline tables. Every source lists, and ids are
 * validated, FIRST, so a listing failure never wipes a previously good baseline. */
export async function snapshotPipeline(args: SnapshotPipelineArgs): Promise<void> {
  const { config, db } = args;

  const sources = [pagesSource({ config, discover: args.discover }), ...(args.sources ?? [])];
  const targets = (await Promise.all(sources.map((s) => s.listForSnapshot()))).flat();
  checkTargetIds(targets);

  // Listing succeeded — safe to replace the old baseline and invalidate any
  // prior dev-run results (they were diffed against the now-replaced baseline).
  clearBaseline(db);
  clearRuns(db);

  const jobs = targets.flatMap((target) =>
    expandViewports(target, config.viewports).map((viewport) => ({ target, viewport })));
  args.progress?.start(jobs.length, "Capturing prod");

  await mapWithConcurrency(jobs, config.concurrency.screenshots, async ({ target, viewport }) => {
    try {
      // capture() never throws; on failure it returns { ok:false, error }.
      const res = await args.captureFn(target.url.prod, viewport, config);
      saveBaselineImage(db, {
        targetId: target.id, source: target.source, label: target.label, path: target.path,
        viewport, prodUrl: target.url.prod, recipeJson: canonicalJson(target.recipe),
        image: res.ok ? res.png : undefined,
        status: res.ok ? "ok" : "error",
        error: res.ok ? undefined : res.error,
      });
    } finally {
      args.progress?.tick();
    }
  });
  args.progress?.stop();

  writeSnapshot(db, {
    createdAt: args.createdAt,
    prodBaseUrl: config.prod,
    viewports: config.viewports,
    stabilize: config.stabilize,
    configJson: JSON.stringify(config),
    browser: config.browser,
  });
}
