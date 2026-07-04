// src/report/report.ts
import type { Database } from "bun:sqlite";
import { readComparisons } from "../store/db";
import { renderReport } from "./template";

export async function writeReport(db: Database, runId: number, outPath: string): Promise<void> {
  const rows = readComparisons(db, runId);
  const run = db.query(`SELECT dev_base_url, prod_base_url FROM runs WHERE id = ?`).get(runId) as any;
  const html = renderReport(rows, { dev: run?.dev_base_url ?? "", prod: run?.prod_base_url ?? "" });
  await Bun.write(outPath, html); // overwrites (spec §6)
}
