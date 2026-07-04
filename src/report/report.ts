// src/report/report.ts
import type { Database } from "bun:sqlite";
import { readComparisons, type ComparisonRow } from "../store/db";
import { renderReport } from "./template";

export async function writeReport(db: Database, runId: number, outPath: string, rows?: ComparisonRow[]): Promise<void> {
  // Accept pre-read rows so callers who already have them (e.g. for the exit
  // code) don't re-read every BLOB; fall back to reading if none are provided.
  rows ??= readComparisons(db, runId);
  const run = db.query(`SELECT dev_base_url, prod_base_url FROM runs WHERE id = ?`).get(runId) as any;
  const html = renderReport(rows, { dev: run?.dev_base_url ?? "", prod: run?.prod_base_url ?? "" });
  await Bun.write(outPath, html); // overwrites (spec §6)
}
