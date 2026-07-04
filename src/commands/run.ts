// src/commands/run.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons, readBaselineImages } from "../store/db";
import { runFlow, type RunFlowResult } from "../pipeline/run-flow";
import type { Job } from "../pipeline/run";
import { exitCodeFor } from "../pipeline/verdict";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";

export async function runCommand(parsed: ParsedCli): Promise<number> {
  if (!isBrowserInstalled()) {
    console.error("No browser found. Run `momus install-browser` first.");
    return 2;
  }

  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  try {
    const raw = await loadConfigFile(configPath);
    config = resolveConfig(raw, parsed.overrides);
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  // Preserve the DB file across runs so a prod baseline is reused (freeze).
  // A run materializes a baseline on first use, then reuses it thereafter.
  const db = openDb(config.output.db);
  const browser = await launchBrowser();
  const diffPool = new DiffPool(config.concurrency.diffWorkers);

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  // Teardown runs in `finally` so both handles always close, even if one close
  // rejects: `browser.close()` must not be skipped when `diffPool.close()` fails.
  let result: RunFlowResult;
  try {
    result = await runFlow({
      config, db, now: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        // `--crawl` forces a link crawl even when prod has a sitemap: disable
        // sitemap discovery for this run so the crawl path is taken.
        sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
      getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
      diffPool,
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
  const rows = readComparisons(db, 1);
  await writeReport(db, 1, config.output.report, rows);
  const code = exitCodeFor(rows);
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
  db.close(); // flush WAL/SHM sidecars cleanly now that we're done writing.
  console.log(`Wrote ${config.output.report} (${rows.length} comparisons). Exit ${code}.`);
  return code;
}
