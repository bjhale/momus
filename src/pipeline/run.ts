// src/pipeline/run.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult, ComparisonRecord } from "../types";
import type { DiffResponse } from "../diff/worker";
import type { Progress } from "../progress";
import { startRun, saveComparison, finishRun } from "../store/db";
import { mapWithConcurrency } from "./queue";
import { resolveFailScore, passed } from "./verdict";

export interface DiffPoolLike {
  submit(a: Uint8Array, b: Uint8Array, threshold: number): Promise<DiffResponse>;
  close(): Promise<void>;
}

/** One unit of comparison work: a path at a viewport, with both side URLs resolved. */
export interface Job {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
}

export interface RunPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  startedAt: string;
  finishedAt?: string;
  /** Prod base URL to record on the run row. Defaults to config.prod. In
   * baseline mode this is the baseline's origin (snapshot.prodBaseUrl), so the
   * report labels prod correctly even when the live config prod differs. */
  prodBaseUrl?: string;
  /** The comparison jobs to run (one-shot: discovery×viewports; baseline: stored rows). */
  listJobs: () => Promise<Job[]>;
  /** Obtain the dev-side image for a job (always a live capture). */
  getDev: (job: Job) => Promise<CaptureResult>;
  /** Obtain the prod-side image for a job (live capture, or read from the baseline store). */
  getProd: (job: Job) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
  /** Optional progress reporter for the capture+diff phase. */
  progress?: Progress;
}

export async function runPipeline(args: RunPipelineArgs): Promise<void> {
  const { config, db } = args;
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: args.prodBaseUrl ?? config.prod,
    configJson: JSON.stringify(config), startedAt: args.startedAt,
  });

  try {
    const jobs = await args.listJobs();
    args.progress?.start(jobs.length, "Capturing dev + diffing");

    await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
      const rec: ComparisonRecord = {
        path: job.path, viewport: job.viewport, devUrl: job.devUrl, prodUrl: job.prodUrl, status: "ok",
      };
      // Per-job guard: an unexpected throw from a seam must be recorded as an
      // error comparison, never propagated — one bad page must not abort the run.
      try {
        const [dev, prod] = await Promise.all([args.getDev(job), args.getProd(job)]);

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
      } finally {
        args.progress?.tick();
      }
    });
    args.progress?.stop();
  } catch (err) {
    // listJobs() or the fan-out failed unexpectedly: record a terminal status so
    // the run row is never orphaned at "running", then re-throw for the CLI.
    finishRun(db, runId, "failed", args.finishedAt ?? new Date().toISOString());
    throw err;
  }

  // diffPool.close() is intentionally NOT called here — the CLI caller owns the
  // pool lifecycle, symmetric with owning listJobs/getDev/getProd.
  finishRun(db, runId, "complete", args.finishedAt ?? new Date().toISOString());
}
