// src/commands/report.ts
import { existsSync } from "node:fs";
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { openDb, latestRunId, listRunIds, readRun } from "../store/db";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";

/** Re-render a stored run. Opens output.db (migrating an old one) but never creates it or touches a browser. */
export async function reportCommand(parsed: ParsedCli): Promise<number> {
  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  try {
    config = resolveConfig(await loadConfigFile(configPath), parsed.overrides);
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  // openDb would create an empty DB; a typo'd path should fail, not do that.
  if (!existsSync(config.output.db)) {
    console.error(`No database at ${config.output.db}. Run \`momus run\` first.`);
    return 2;
  }
  let db;
  try {
    db = openDb(config.output.db);
  } catch (err) {
    console.error(`Database error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  try {
    const runId = parsed.runId ?? latestRunId(db);
    if (runId === null) {
      console.error(`No runs in ${config.output.db}. Run \`momus run\` first.`);
      return 2;
    }
    const run = readRun(db, runId);
    if (!run) {
      console.error(`Run ${runId} not found in ${config.output.db}. Available: ${listRunIds(db).join(", ")}.`);
      return 2;
    }
    await writeReport(db, runId, config.output.report);
    // Rendering succeeded, so exit 0, but the report says FAIL for a reason
    // the terminal user should hear too.
    if (run.status !== "complete") {
      console.error(`Warning: run #${runId} has status "${run.status}", not "complete"; the report shows FAIL.`);
    }
    console.log(`Wrote ${config.output.report} for run #${runId}.`);
    return 0;
  } finally {
    db.close();
  }
}
