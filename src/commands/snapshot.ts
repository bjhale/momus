// src/commands/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { makeFetcher } from "../discovery/fetcher";
import { openDb, readBaselineImages } from "../store/db";
import { snapshotPipeline } from "../pipeline/snapshot";
import type { ResolvedConfig } from "../config/schema";
import { scenariosSource } from "../targets/scenarios";
import { makeProgress } from "../progress";

export async function snapshotCommand(parsed: ParsedCli): Promise<number> {
  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  try {
    const raw = await loadConfigFile(configPath);
    config = resolveConfig(raw, parsed.overrides);
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
    return await snapshotWithDb(config, db);
  } finally {
    db.close();
  }
}

async function snapshotWithDb(config: ResolvedConfig, db: Database): Promise<number> {
  const browser = await launchBrowser(config.browser);
  const progress = makeProgress();

  const realFetch = makeFetcher(config.insecure, config.requestHeaders);

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
      captureFn: (url, vw, cfg, recipe) => capture(browser, url, vw, cfg.stabilize, cfg.insecure, cfg.requestHeaders, { recipe }),
      progress,
    });
  } catch (err) {
    console.error(`Snapshot failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser.close().catch(() => {});
  }

  const count = readBaselineImages(db).length;
  console.log(`Wrote baseline to ${config.output.db} (${count} prod captures). Exit 0.`);
  return 0;
}
