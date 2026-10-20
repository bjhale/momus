// src/commands/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser, renderingMode, type Rendering } from "../capture/browser";
import { captureSeams } from "./capture-seams";
import { discoverPaths } from "../discovery/discover";
import { makeFetcher } from "../discovery/fetcher";
import { openDb, readBaselineImages } from "../store/db";
import { snapshotPipeline } from "../pipeline/snapshot";
import type { ResolvedConfig } from "../config/schema";
import { scenariosSource } from "../targets/scenarios";
import { makeProgress } from "../progress";
import { DiffPool } from "../diff/pool";

export async function snapshotCommand(parsed: ParsedCli): Promise<number> {
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

  // Open (create if absent) — do NOT delete the DB file: a snapshot only
  // replaces the baseline tables, leaving the file available for later runs.
  let db;
  try {
    db = openDb(config.output.db);
  } catch (err) {
    console.error(`Database error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  try {
    return await snapshotWithDb(config, db, rendering);
  } finally {
    db.close();
  }
}

async function snapshotWithDb(config: ResolvedConfig, db: Database, rendering: Rendering): Promise<number> {
  const browser = await launchBrowser(config.browser, rendering);
  const progress = makeProgress();

  const realFetch = makeFetcher(config.insecure, config.requestHeaders);

  const seams = captureSeams(browser, config);
  // Only verify diffs during a snapshot; don't spawn workers otherwise.
  const diffPool = config.stabilize.verify ? new DiffPool(config.concurrency.diffWorkers) : undefined;

  try {
    await snapshotPipeline({
      config, db, createdAt: new Date().toISOString(),
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
      setup: seams.setupProd,
      captureFn: seams.captureProd,
      progress,
      diffPool,
      rendering,
      engineVersion: browser.version(),
    });
  } catch (err) {
    console.error(`Snapshot failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await diffPool?.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const count = readBaselineImages(db).length;
  console.log(`Wrote baseline to ${config.output.db} (${count} prod captures). Exit 0.`);
  return 0;
}
