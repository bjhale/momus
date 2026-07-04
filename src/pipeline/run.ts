// src/pipeline/run.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult, ComparisonRecord } from "../types";
import type { DiffResponse } from "../diff/worker";
import { startRun, saveComparison, finishRun } from "../store/db";
import { mapWithConcurrency } from "./queue";
import { resolveFailScore, passed } from "./verdict";

export interface DiffPoolLike {
  submit(a: Uint8Array, b: Uint8Array, threshold: number): Promise<DiffResponse>;
  close(): Promise<void>;
}

export interface RunPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  startedAt: string;
  finishedAt: string;
  discover: () => Promise<string[]>;
  captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
}

export async function runPipeline(args: RunPipelineArgs): Promise<void> {
  const { config, db } = args;
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: config.prod,
    configJson: JSON.stringify(config), startedAt: args.startedAt,
  });

  try {
    const paths = await args.discover();
    // Fan out into path × viewport jobs.
    const jobs = paths.flatMap((path) =>
      config.viewports.map((viewport) => ({ path, viewport })));

    await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
      const devUrl = new URL(job.path, config.dev).toString();
      const prodUrl = new URL(job.path, config.prod).toString();
      const rec: ComparisonRecord = {
        path: job.path, viewport: job.viewport, devUrl, prodUrl, status: "ok",
      };
      // Per-job guard: an unexpected throw from a seam (captureFn/diffPool) must
      // be recorded as an error comparison, never propagated — one bad page must
      // not abort the whole run (spec §3).
      try {
        const [dev, prod] = await Promise.all([
          args.captureFn(devUrl, job.viewport, config),
          args.captureFn(prodUrl, job.viewport, config),
        ]);

        if (!dev.ok || !prod.ok) {
          rec.status = "error";
          rec.error = [dev.ok ? null : `dev: ${dev.error}`, prod.ok ? null : `prod: ${prod.error}`]
            .filter(Boolean).join("; ");
          saveComparison(db, runId, rec);
          return;
        }

        rec.devImage = dev.png; rec.prodImage = prod.png;
        const diff = await args.diffPool.submit(dev.png!, prod.png!, config.diff.threshold);
        if (!diff.ok) {
          rec.status = "error"; rec.error = `diff: ${diff.error}`;
          saveComparison(db, runId, rec);
          return;
        }
        rec.diffImage = diff.diffPng; rec.width = diff.width; rec.height = diff.height;
        rec.diffPixels = diff.diffPixels; rec.diffScore = diff.diffScore;
        const failScore = resolveFailScore(job.path, config.diff.failScore, config.diff.overrides);
        rec.passed = passed(diff.diffScore!, failScore);
        saveComparison(db, runId, rec);
      } catch (err) {
        rec.status = "error";
        rec.error = err instanceof Error ? err.message : String(err);
        saveComparison(db, runId, rec);
      }
    });
  } catch (err) {
    // discover() or the fan-out itself failed unexpectedly: record a terminal
    // status so the run row is never orphaned at "running", then re-throw so the
    // CLI can still surface the failure.
    finishRun(db, runId, "failed", args.finishedAt);
    throw err;
  }

  // NOTE: diffPool.close() is intentionally NOT called here — the CLI caller
  // (Chunk 7) owns the pool lifecycle, symmetric with owning discover/captureFn.
  finishRun(db, runId, "complete", args.finishedAt);
}
