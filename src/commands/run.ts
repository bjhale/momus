// src/commands/run.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons } from "../store/db";
import { runPipeline } from "../pipeline/run";
import { exitCodeFor } from "../pipeline/verdict";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";

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

  // Single-run mode: start from a truly fresh DB file (spec §5/§7), removing any
  // stale WAL/SHM sidecars from a prior run.
  for (const suffix of ["", "-wal", "-shm"]) {
    try { await Bun.file(config.output.db + suffix).delete(); } catch { /* absent */ }
  }
  const db = openDb(config.output.db);
  const browser = await launchBrowser();
  const diffPool = new DiffPool(config.concurrency.diffWorkers);

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  const now = new Date().toISOString();
  try {
    await runPipeline({
      config, db, startedAt: now, finishedAt: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        sitemap: config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureFn: (url: string, vw: number, cfg: ResolvedConfig): Promise<CaptureResult> =>
        capture(browser, url, vw, cfg.stabilize),
      diffPool,
    });
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    await diffPool.close();
    await browser.close();
    return 2;
  }
  await diffPool.close();
  await browser.close();

  await writeReport(db, 1, config.output.report);
  const rows = readComparisons(db, 1);
  const code = exitCodeFor(rows);
  console.log(`Wrote ${config.output.report} (${rows.length} comparisons). Exit ${code}.`);
  return code;
}
