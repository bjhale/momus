// src/pipeline/run-flow.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import type { Progress } from "../progress";
import { readSnapshot, readBaselineImages, type BaselineImageRow } from "../store/db";
import { snapshotPipeline } from "./snapshot";
import { baselineConflict } from "./compat";
import { runPipeline, type Job, type DiffPoolLike } from "./run";

export interface RunFlowArgs {
  config: ResolvedConfig;
  db: Database;
  /** Timestamp for both a materialized snapshot and the run row. */
  now: string;
  /** Discover prod paths — only called when a baseline must be materialized. */
  discover: () => Promise<string[]>;
  /** Capture a prod page — only called when materializing a baseline. */
  captureProd: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  /** Capture a dev page — always a live capture. */
  getDev: (job: Job) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
  progress?: Progress;
}

export type RunFlowResult =
  | { ok: true; materialized: boolean; createdAt: string }
  | { ok: false; conflict: string };

/** Ensure a prod baseline exists (capturing one in-invocation if absent), then
 * diff live dev against it. Freeze semantics: a baseline, once materialized, is
 * reused by later runs — refresh it with `momus snapshot`. */
export async function runFlow(args: RunFlowArgs): Promise<RunFlowResult> {
  const { config, db } = args;

  let snapshot = readSnapshot(db);
  let materialized = false;
  if (!snapshot) {
    // No baseline yet — materialize one now (discover + capture prod). Same
    // ordering guarantees as `momus snapshot`: discovery runs before any clear.
    // snapshotPipeline clears runs/comparisons; runPipeline's startRun clears
    // them again below. Benign double-clear — nothing is written in between.
    await snapshotPipeline({
      config, db, createdAt: args.now,
      discover: args.discover,
      captureFn: args.captureProd,
      progress: args.progress,
    });
    snapshot = readSnapshot(db)!;
    materialized = true;
  }

  const conflict = baselineConflict(config, snapshot);
  if (conflict) return { ok: false, conflict };

  const images = readBaselineImages(db);
  const byKey = new Map<string, BaselineImageRow>(
    images.map((im) => [`${im.path} ${im.viewport}`, im]));

  await runPipeline({
    config, db, startedAt: args.now, prodBaseUrl: snapshot.prodBaseUrl,
    listJobs: async (): Promise<Job[]> => images.map((im) => ({
      path: im.path, viewport: im.viewport,
      devUrl: new URL(im.path, config.dev).toString(),
      prodUrl: im.prodUrl,
    })),
    getDev: args.getDev,
    getProd: async (job: Job) => {
      const im = byKey.get(`${job.path} ${job.viewport}`)!;
      return im.status === "ok" && im.image
        ? { ok: true, png: im.image }
        : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
    },
    diffPool: args.diffPool,
    progress: args.progress,
  });

  return { ok: true, materialized, createdAt: snapshot.createdAt };
}
