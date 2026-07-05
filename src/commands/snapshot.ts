// src/commands/snapshot.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { openDb, readBaselineImages } from "../store/db";
import { snapshotPipeline } from "../pipeline/snapshot";
import type { ResolvedConfig } from "../config/schema";

export async function snapshotCommand(parsed: ParsedCli): Promise<number> {
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

  // Open (create if absent) — do NOT delete the DB file: a snapshot only
  // replaces the baseline tables, leaving the file available for later runs.
  const db = openDb(config.output.db);
  const browser = await launchBrowser();

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  try {
    await snapshotPipeline({
      config, db, createdAt: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        maxPages: config.discovery.maxPages,
        sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
    });
  } catch (err) {
    console.error(`Snapshot failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser.close().catch(() => {});
  }

  const count = readBaselineImages(db).length;
  db.close();
  console.log(`Wrote baseline to ${config.output.db} (${count} prod captures). Exit 0.`);
  return 0;
}
