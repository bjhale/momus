// src/pipeline/run-flow.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import type { Progress } from "../progress";
import { readSnapshot, readBaselineImages, pruneRuns, type BaselineImageRow, type SnapshotMeta, type CiMetadata } from "../store/db";
import { snapshotPipeline } from "./snapshot";
import { baselineConflict } from "./compat";
import { runPipeline, type Job, type DiffPoolLike } from "./run";
import { pagesSource } from "../targets/pages";
import { reconcile } from "../targets/reconcile";
import { canonicalJson, checkTargetIds, type Recipe, type Target, type TargetSource, type TargetSourceName } from "../targets/target";

export interface RunFlowArgs {
  config: ResolvedConfig;
  db: Database;
  /** Timestamp for both a materialized snapshot and the run row. */
  now: string;
  /** Discover prod paths — only called when a baseline must be materialized. */
  discover: () => Promise<string[]>;
  /** Sources beyond pages, e.g. scenariosSource (RFC-0004). */
  sources?: TargetSource[];
  /** Read the urlList file; injectable for tests. A run re-reads it so new
   * entries show as `added` (ADR-0022). */
  readUrlList?: (path: string) => Promise<string>;
  /** Capture a prod page — only called when materializing a baseline. */
  captureProd: (url: string, viewport: number, cfg: ResolvedConfig, recipe?: Recipe) => Promise<CaptureResult>;
  /** Capture a dev page — always a live capture. */
  getDev: (job: Job) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
  progress?: Progress;
  /** Force a new baseline: re-discover and re-capture prod even when the DB
   * already holds one (ignores freeze) — `momus run --snapshot`. Named
   * `forceSnapshot`, not `snapshot`, so it can't be misread as the baseline row
   * this flow reads below. */
  forceSnapshot?: boolean;
  engineVersion?: string;
  ci?: CiMetadata;
}

export type RunFlowResult =
  | { ok: true; materialized: boolean; createdAt: string; runId: number }
  | { ok: false; conflict: string };

/** What a run records about its baseline. Everything that decides whether the
 * baseline is diffable, plus its id and age; not the full config. */
export function baselineIdentityJson(s: SnapshotMeta): string {
  return canonicalJson({
    id: s.id, createdAt: s.createdAt, prodBaseUrl: s.prodBaseUrl,
    browser: s.browser ?? "chromium", viewports: s.viewports, stabilize: s.stabilize,
  })!;
}

/** Ensure a prod baseline exists (capturing one in-invocation if absent), then
 * diff live dev against it. Freeze semantics: a baseline, once materialized, is
 * reused by later runs — refresh it with `momus snapshot`. */
export async function runFlow(args: RunFlowArgs): Promise<RunFlowResult> {
  const { config, db } = args;

  let snapshot = readSnapshot(db);
  let materialized = false;
  if (!snapshot || args.forceSnapshot) {
    // No baseline yet, or `--snapshot` forced a re-capture — materialize one now
    // (discover + capture prod). Same ordering guarantees as `momus snapshot`:
    // discovery runs before any clear.
    await snapshotPipeline({
      config, db, createdAt: args.now,
      discover: args.discover,
      sources: args.sources,
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
    images.map((im) => [`${im.targetId} ${im.viewport}`, im]));
  const sources: TargetSource[] = [
    pagesSource({ config, discover: args.discover, readUrlList: args.readUrlList, urlListBase: snapshot.prodBaseUrl }),
    ...(args.sources ?? []),
  ];

  const runId = await runPipeline({
    config, db, startedAt: args.now, prodBaseUrl: snapshot.prodBaseUrl,
    engineVersion: args.engineVersion, ci: args.ci,
    baseline: { id: snapshot.id!, identityJson: baselineIdentityJson(snapshot) },
    listJobs: async (): Promise<Job[]> => {
      const live = new Map<TargetSourceName, Target[]>();
      const failed = new Map<TargetSourceName, string>();
      for (const source of sources) {
        // One source failing must not abort the run or fake every one of its
        // targets as removed: reconcile() turns it into a single error row.
        try {
          const targets = await source.listLive(images.filter((im) => im.source === source.name));
          checkTargetIds(targets);
          live.set(source.name, targets);
        } catch (err) {
          failed.set(source.name, err instanceof Error ? err.message : String(err));
        }
      }
      return reconcile({ baseline: images, live, failed, viewports: config.viewports });
    },
    getDev: args.getDev,
    getProd: async (job: Job) => {
      const im = byKey.get(`${job.targetId ?? job.path} ${job.viewport}`);
      if (!im) return { ok: false, error: "no baseline image for this target" };
      return im.status === "ok" && im.image
        ? { ok: true, png: im.image }
        : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
    },
    diffPool: args.diffPool,
    progress: args.progress,
  });
  // After the run, so the run just written always survives.
  pruneRuns(db, config.output.keepRuns);

  return { ok: true, materialized, createdAt: snapshot.createdAt, runId };
}
