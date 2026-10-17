// src/pipeline/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import type { Progress } from "../progress";
import { clearBaseline, saveBaselineImage, writeSnapshot } from "../store/db";
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

/** Every prod capture failed, so there is nothing worth freezing. Thrown after
 * the baseline replacement is rolled back; the commands exit 2 with this
 * message (RFC-0002, ADR-0027). */
export class ProdUnreachableError extends Error {
  constructor(prod: string, total: number, firstError: string) {
    super(`prod was unreachable: every prod capture failed (${total} of ${total}) at ${prod}. ` +
      `First error: ${firstError}. No baseline was saved; any previous baseline is unchanged.`);
    this.name = "ProdUnreachableError";
  }
}

/** Capture prod once into the baseline tables. Every source lists, and ids are
 * validated, FIRST, so a listing failure never wipes a previously good baseline.
 * The replacement is all-or-nothing: clear, capture, and write happen in one
 * transaction, so an all-error capture (ProdUnreachableError) or a crash leaves
 * the previous baseline untouched. A partly failing capture still commits. */
export async function snapshotPipeline(args: SnapshotPipelineArgs): Promise<void> {
  const { config, db } = args;

  const sources = [pagesSource({ config, discover: args.discover }), ...(args.sources ?? [])];
  const targets = (await Promise.all(sources.map((s) => s.listForSnapshot()))).flat();
  checkTargetIds(targets);

  const jobs = targets.flatMap((target) =>
    expandViewports(target, config.viewports).map((viewport) => ({ target, viewport })));

  // One transaction from clear to writeSnapshot: the old baseline is replaced
  // only if the new one is worth keeping, and a crash mid-capture can't leave
  // half a baseline. A manual BEGIN because captures await between writes; all
  // writes still happen on this thread. Runs are kept: each holds its own prod
  // images and records which baseline it used (ADR-0025).
  db.exec("BEGIN IMMEDIATE;");
  let committed = false;
  try {
    clearBaseline(db);
    args.progress?.start(jobs.length, "Capturing prod");
    let failed = 0;
    let firstError = "";
    await mapWithConcurrency(jobs, config.concurrency.screenshots, async ({ target, viewport }) => {
      try {
        // capture() never throws; on failure it returns { ok:false, error }.
        const res = await args.captureFn(target.url.prod, viewport, config);
        if (!res.ok) { failed++; firstError ||= res.error ?? "unknown error"; }
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
    if (jobs.length > 0 && failed === jobs.length) throw new ProdUnreachableError(config.prod, jobs.length, firstError);

    writeSnapshot(db, {
      createdAt: args.createdAt,
      prodBaseUrl: config.prod,
      viewports: config.viewports,
      stabilize: config.stabilize,
      configJson: JSON.stringify(config),
      browser: config.browser,
    });
    db.exec("COMMIT;");
    committed = true;
  } finally {
    if (!committed) db.exec("ROLLBACK;");
  }
}
