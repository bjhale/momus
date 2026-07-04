// tests/e2e/baseline.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons, readSnapshot, readBaselineImages, type BaselineImageRow } from "../../src/store/db";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { ConfigSchema } from "../../src/config/schema";

const maybe = isBrowserInstalled() ? test : test.skip;

function serve(pages: Record<string, string>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const body = pages[path];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
  });
}

maybe("snapshot prod once, then run dev against it: unchanged passes, changed fails", async () => {
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });

  const config = ConfigSchema.parse({
    dev: "http://localhost:1", // overwritten per phase below via job URLs
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    // --- Phase 1: snapshot prod ---
    await snapshotPipeline({
      config, db, createdAt: "2026-07-04T00:00:00Z",
      discover: async () => ["/", "/about"],
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
    });
    expect(readSnapshot(db)).not.toBeNull();
    expect(readBaselineImages(db).length).toBe(2);

    // --- Phase 2: run dev against the baseline (dev "/about" changed) ---
    const dev = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
    });
    const images = readBaselineImages(db);
    const byKey = new Map<string, BaselineImageRow>(images.map((im) => [`${im.path} ${im.viewport}`, im]));
    try {
      await runPipeline({
        config, db, startedAt: "2026-07-04T00:01:00Z", finishedAt: "2026-07-04T00:02:00Z",
        listJobs: async (): Promise<Job[]> => images.map((im) => ({
          path: im.path, viewport: im.viewport,
          devUrl: `http://localhost:${dev.port}${im.path}`, prodUrl: im.prodUrl,
        })),
        getDev: (job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
        getProd: async (job) => {
          const im = byKey.get(`${job.path} ${job.viewport}`)!;
          return im.status === "ok" && im.image ? { ok: true, png: im.image } : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
        },
        diffPool: pool,
      });
    } finally { dev.stop(); }

    const rows = readComparisons(db, 1);
    expect(rows.find((r) => r.path === "/")!.passed).toBe(true);
    expect(rows.find((r) => r.path === "/about")!.passed).toBe(false);
    // Baseline survived the run.
    expect(readBaselineImages(db).length).toBe(2);
  } finally {
    await pool.close(); await browser.close(); prod.stop();
  }
});
