// src/pipeline/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import type { Progress } from "../progress";
import { clearBaseline, clearRuns, saveBaselineImage, writeSnapshot } from "../store/db";
import { mapWithConcurrency } from "./queue";

export interface SnapshotPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  createdAt: string;
  discover: () => Promise<string[]>;
  captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  progress?: Progress;
}

/** Capture prod once into the baseline tables. Discovery runs FIRST so a
 * discovery failure never wipes a previously good baseline. */
export async function snapshotPipeline(args: SnapshotPipelineArgs): Promise<void> {
  const { config, db } = args;

  const paths = await args.discover();

  // Discovery succeeded — safe to replace the old baseline and invalidate any
  // prior dev-run results (they were diffed against the now-replaced baseline).
  clearBaseline(db);
  clearRuns(db);

  const jobs = paths.flatMap((path) => config.viewports.map((viewport) => ({
    path, viewport, prodUrl: new URL(path, config.prod).toString(),
  })));
  args.progress?.start(jobs.length, "Capturing prod");

  await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
    try {
      // capture() never throws; on failure it returns { ok:false, error }.
      const res = await args.captureFn(job.prodUrl, job.viewport, config);
      saveBaselineImage(db, {
        path: job.path, viewport: job.viewport, prodUrl: job.prodUrl,
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
