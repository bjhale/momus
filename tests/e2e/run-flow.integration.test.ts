// tests/e2e/run-flow.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons, readSnapshot, readBaselineImages } from "../../src/store/db";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema } from "../../src/config/schema";
import type { Job } from "../../src/pipeline/run";

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

maybe("first run materializes prod baseline; second run freezes (no prod re-capture)", async () => {
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });
  const config = ConfigSchema.parse({
    dev: "http://localhost:1",   // per-job dev URLs are built from config.dev; overridden below via a dev server
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    // --- Run 1: dev matches prod. No baseline yet → materialize + diff. ---
    const dev1 = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
    });
    let res;
    try {
      res = await runFlow({
        config, db, now: "2026-07-04T10:00:00Z",
        discover: async () => ["/", "/about"],
        captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
        getDev: (job: Job) => capture(browser, `http://localhost:${dev1.port}${job.path}`, job.viewport, config.stabilize),
        diffPool: pool,
      });
    } finally { dev1.stop(); }

    expect(res).toEqual({ ok: true, materialized: true, createdAt: "2026-07-04T10:00:00Z" });
    expect(readBaselineImages(db).length).toBe(2);
    expect(readComparisons(db, 1).every((r) => r.passed)).toBe(true); // dev == prod

    // --- Run 2: dev changed /about. Baseline frozen → prod not re-captured. ---
    const dev2 = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
    });
    let res2;
    try {
      res2 = await runFlow({
        config, db, now: "2026-07-04T11:00:00Z",
        discover: async () => { throw new Error("must not discover on a frozen baseline"); },
        captureProd: async () => { throw new Error("must not re-capture prod on a frozen baseline"); },
        getDev: (job: Job) => capture(browser, `http://localhost:${dev2.port}${job.path}`, job.viewport, config.stabilize),
        diffPool: pool,
      });
    } finally { dev2.stop(); }

    expect(res2).toEqual({ ok: true, materialized: false, createdAt: "2026-07-04T10:00:00Z" });
    const rows = readComparisons(db, 1);
    expect(rows.find((r) => r.path === "/")!.passed).toBe(true);
    expect(rows.find((r) => r.path === "/about")!.passed).toBe(false); // changed vs frozen prod
    expect(readSnapshot(db)!.createdAt).toBe("2026-07-04T10:00:00Z"); // baseline preserved
  } finally {
    await pool.close(); await browser.close(); prod.stop();
  }
});
