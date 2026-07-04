// src/commands/run.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons, readSnapshot, readBaselineImages, type BaselineImageRow } from "../store/db";
import { runPipeline, type Job } from "../pipeline/run";
import { baselineConflict } from "../pipeline/compat";
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

  // Preserve the DB file across runs so a prod baseline (if present) is reused.
  // runPipeline's startRun truncates only runs/comparisons.
  const db = openDb(config.output.db);
  const browser = await launchBrowser();
  const diffPool = new DiffPool(config.concurrency.diffWorkers);

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  const snapshot = readSnapshot(db);
  const getDev = (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize);

  // Teardown runs in `finally` so both handles always close, even if one close
  // rejects or writeReport throws: `browser.close()` must not be skipped when
  // `diffPool.close()` fails, hence the independent `.catch()` guards.
  try {
    if (snapshot) {
      // Baseline mode: diff live dev against stored prod images; do not re-hit prod.
      const conflict = baselineConflict(config, snapshot);
      if (conflict) {
        console.error(`Baseline conflict: ${conflict}`);
        return 2;
      }
      const images = readBaselineImages(db);
      const byKey = new Map<string, BaselineImageRow>(
        images.map((im) => [`${im.path} ${im.viewport}`, im]));

      await runPipeline({
        config, db, startedAt: new Date().toISOString(),
        listJobs: async (): Promise<Job[]> => images.map((im) => ({
          path: im.path, viewport: im.viewport,
          devUrl: new URL(im.path, config.dev).toString(),
          prodUrl: im.prodUrl,
        })),
        getDev,
        getProd: async (job: Job) => {
          const im = byKey.get(`${job.path} ${job.viewport}`)!;
          return im.status === "ok" && im.image
            ? { ok: true, png: im.image }
            : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
        },
        diffPool,
      });
    } else {
      // One-shot mode: discover + capture both sides live (unchanged behavior).
      await runPipeline({
        config, db, startedAt: new Date().toISOString(),
        listJobs: async (): Promise<Job[]> => {
          const paths = await discoverPaths({
            base: config.prod,
            // `--crawl` forces a link crawl even when prod has a sitemap: disable
            // sitemap discovery for this run so the crawl path is taken.
            sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
            crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                     maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
            include: config.discovery.include, exclude: config.discovery.exclude,
            fetcher: realFetch,
          });
          return paths.flatMap((path) => config.viewports.map((viewport) => ({
            path, viewport,
            devUrl: new URL(path, config.dev).toString(),
            prodUrl: new URL(path, config.prod).toString(),
          })));
        },
        getDev,
        getProd: (job: Job) => capture(browser, job.prodUrl, job.viewport, config.stabilize),
        diffPool,
      });
    }
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await diffPool.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // Read comparisons once and reuse for both the report and the exit code,
  // instead of reading every BLOB row twice.
  const rows = readComparisons(db, 1);
  await writeReport(db, 1, config.output.report, rows);
  db.close(); // flush WAL/SHM sidecars cleanly now that we're done writing.
  const code = exitCodeFor(rows);
  console.log(`Wrote ${config.output.report} (${rows.length} comparisons). Exit ${code}.`);
  return code;
}
