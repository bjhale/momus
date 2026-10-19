// src/commands/run.ts
import type { Database } from "bun:sqlite";
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser, renderingMode, type Rendering } from "../capture/browser";
import { discoverPaths } from "../discovery/discover";
import { makeFetcher } from "../discovery/fetcher";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons, readBaselineImages } from "../store/db";
import { runFlow, type RunFlowResult } from "../pipeline/run-flow";
import { captureSeams } from "./capture-seams";
import { exitCodeFor } from "../pipeline/verdict";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";
import type { ComparisonRecord } from "../types";
import { scenariosSource } from "../targets/scenarios";
import { makeProgress } from "../progress";

export async function runCommand(parsed: ParsedCli): Promise<number> {
  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  let rendering: Rendering;
  try {
    const raw = await loadConfigFile(configPath);
    config = resolveConfig(raw, parsed.overrides);
    rendering = renderingMode();
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  if (!isBrowserInstalled(config.browser)) {
    console.error(`No ${config.browser} browser found. Run \`momus install-browser\` first.`);
    return 2;
  }

  // Preserve the DB file across runs so a prod baseline is reused (freeze).
  // A run materializes a baseline on first use, then reuses it thereafter.
  let db;
  try {
    db = openDb(config.output.db);
  } catch (err) {
    console.error(`Database error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  // Everything after this point closes the handle exactly once, in the outer
  // finally, so no early return can leak it.
  try {
    return await runWithDb(parsed, config, db, rendering);
  } finally {
    db.close(); // also flushes WAL/SHM sidecars cleanly.
  }
}

async function runWithDb(parsed: ParsedCli, config: ResolvedConfig, db: Database, rendering: Rendering): Promise<number> {
  const browser = await launchBrowser(config.browser, rendering);
  const diffPool = new DiffPool(config.concurrency.diffWorkers);
  const progress = makeProgress();

  const realFetch = makeFetcher(config.insecure, config.requestHeaders);

  // Teardown runs in `finally` so both handles always close, even if one close
  // rejects: `browser.close()` must not be skipped when `diffPool.close()` fails.
  let result: RunFlowResult;
  try {
    result = await runFlow({
      config, db, now: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        urlList: config.discovery.urlList,
        maxPages: config.discovery.maxPages,
        sitemap: config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      sources: [scenariosSource(config)],
      ...captureSeams(browser, config),
      diffPool,
      progress,
      forceSnapshot: parsed.forceSnapshot,
      engineVersion: browser.version(),
      rendering,
      ci: parsed.ci,
    });
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await diffPool.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!result.ok) {
    console.error(`Baseline conflict: ${result.conflict}`);
    return 2;
  }

  // Read comparisons once and reuse for both the report and the exit code.
  const rows = readComparisons(db, result.runId);
  // config.diff carries allowAdded/allowRemoved; one gate for report and exit code.
  await writeReport(db, result.runId, config.output.report, rows);
  const code = exitCodeFor(rows, config.diff);
  // Make freezing explicit: say whether prod was captured now or reused.
  if (result.materialized) {
    const images = readBaselineImages(db);
    const total = images.length;
    const failed = images.filter((im) => im.status === "error").length;
    const ok = total - failed;
    console.log(failed === 0
      ? `Captured prod baseline (${ok} pages).`
      : `Captured prod baseline (${ok}/${total} pages; ${failed} failed).`);
  } else {
    console.log(`Reused prod baseline from ${result.createdAt}. Refresh with \`momus snapshot\`.`);
  }
  console.log(resultLine(config.output.report, result.runId, rows, code));
  return code;
}

/** The run's last stdout line. Unstable targets are named here because they
 * don't move the exit code: a CI log is otherwise all a reviewer sees. */
export function resultLine(report: string, runId: number, rows: ComparisonRecord[], code: number): string {
  const unstable = rows.filter((r) => r.status === "unstable").length;
  const detail = `${rows.length} comparisons${unstable ? `; ${unstable} unstable, not gated` : ""}`;
  return `Wrote ${report} for run #${runId} (${detail}). Exit ${code}.`;
}
