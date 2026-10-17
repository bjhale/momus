// src/pipeline/run.ts
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult, ComparisonRecord } from "../types";
import type { DiffResponse } from "../diff/worker";
import type { Progress } from "../progress";
import { redactConfig } from "../config/redact";
import { canonicalJson, type Recipe, type TargetSourceName } from "../targets/target";
import { startRun, saveComparison, finishRun, type CiMetadata } from "../store/db";
import { MOMUS_VERSION } from "../version";
import { mapWithConcurrency } from "./queue";
import { resolveFailScore, passed } from "./verdict";

/** sha256 of the resolved config (setup secrets redacted first, so none is
 * ever hashed) with sorted keys, so two runs with the same
 * effective config hash alike regardless of how the file was written. */
export function configHash(config: ResolvedConfig): string {
  return createHash("sha256").update(canonicalJson(redactConfig(config))!).digest("hex");
}

export interface DiffPoolLike {
  submit(a: Uint8Array, b: Uint8Array, threshold: number): Promise<DiffResponse>;
  close(): Promise<void>;
}

/** What runPipeline does with a job. reconcile() decides; capture and diff
 * never look at `source` (RFC-0001). */
export type JobAction = "compare" | "added" | "removed" | "error";

/** One unit of comparison work: a target at a viewport, with both side URLs
 * resolved. Identity and action are optional and default to a page compare
 * (id = label = path, source = pages), which is the pre-targets job shape. */
export interface Job {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
  targetId?: string;
  source?: TargetSourceName;
  label?: string;
  /** The target's recipe; capture runs it on both sides. */
  recipe?: Recipe;
  action?: JobAction;
  /** Message for action "error". */
  error?: string;
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
  /** Browser build that captured dev, e.g. "131.0.6778.33". */
  engineVersion?: string;
  /** The baseline these jobs diff against: id plus identity JSON. */
  baseline?: { id: number; identityJson: string };
  ci?: CiMetadata;
}

export async function runPipeline(args: RunPipelineArgs): Promise<number> {
  const { config, db } = args;
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: args.prodBaseUrl ?? config.prod,
    configJson: JSON.stringify(redactConfig(config)), startedAt: args.startedAt,
    momusVersion: MOMUS_VERSION, engine: config.browser, engineVersion: args.engineVersion,
    configHash: configHash(config),
    baselineId: args.baseline?.id, baselineJson: args.baseline?.identityJson,
    allowAdded: config.diff.allowAdded, allowRemoved: config.diff.allowRemoved,
    ci: args.ci,
  });

  try {
    const jobs = await args.listJobs();
    args.progress?.start(jobs.length, "Capturing dev + diffing");

    await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
      const rec: ComparisonRecord = {
        targetId: job.targetId ?? job.path, source: job.source ?? "pages", label: job.label ?? job.path,
        path: job.path, viewport: job.viewport, devUrl: job.devUrl, prodUrl: job.prodUrl, status: "ok",
      };
      // Per-job guard: an unexpected throw from a seam must be recorded as an
      // error comparison, never propagated — one bad page must not abort the run.
      try {
        const action = job.action ?? "compare";
        if (action === "error") {
          rec.status = "error"; rec.error = job.error ?? "unknown error";
          saveComparison(db, runId, rec);
          return;
        }
        if (action === "removed") {
          // Gone from the live list: nothing to capture. Show what the baseline held.
          const prod = await args.getProd(job);
          rec.status = "removed";
          if (prod.ok) rec.prodImage = prod.png; else rec.error = `prod: ${prod.error}`;
          saveComparison(db, runId, rec);
          return;
        }
        if (action === "added") {
          // No baseline to diff against: capture dev so a reviewer can see it.
          const dev = await args.getDev(job);
          if (dev.ok) { rec.status = "added"; rec.devImage = dev.png; }
          else { rec.status = "error"; rec.error = `dev: ${dev.error}`; }
          saveComparison(db, runId, rec);
          return;
        }

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
        rec.failScore = failScore;
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
  return runId;
}
