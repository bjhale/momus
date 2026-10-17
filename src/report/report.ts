// src/report/report.ts
import type { Database } from "bun:sqlite";
import { readComparisons, readRun, type ComparisonRow } from "../store/db";
import { renderReport } from "./template";

/** Render one stored run. The gate comes from the run row, so an old run
 * re-renders with the verdict it had, whatever today's config says. */
export async function writeReport(db: Database, runId: number, outPath: string, rows?: ComparisonRow[]): Promise<void> {
  const run = readRun(db, runId);
  if (!run) throw new Error(`run ${runId} not found`);
  // Accept pre-read rows so callers who already have them (e.g. for the exit
  // code) don't re-read every BLOB.
  rows ??= readComparisons(db, runId);
  const html = renderReport(
    rows,
    { dev: run.devBaseUrl, prod: run.prodBaseUrl, runId: run.id, startedAt: run.startedAt, status: run.status },
    { allowAdded: run.allowAdded, allowRemoved: run.allowRemoved },
  );
  await Bun.write(outPath, html); // overwrites (spec §6)
}
