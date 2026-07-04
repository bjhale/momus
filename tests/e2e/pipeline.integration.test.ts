// tests/e2e/pipeline.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons } from "../../src/store/db";
import { runPipeline } from "../../src/pipeline/run";
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

maybe("dev vs prod: unchanged page passes, changed page fails", async () => {
  const dev = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
  });
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });

  const config = ConfigSchema.parse({
    dev: `http://localhost:${dev.port}`,
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    await runPipeline({
      config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
      discover: async () => ["/", "/about"],
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
      diffPool: pool,
    });
  } finally {
    await pool.close(); await browser.close(); dev.stop(); prod.stop();
  }

  const rows = readComparisons(db, 1);
  const home = rows.find((r) => r.path === "/")!;
  const about = rows.find((r) => r.path === "/about")!;
  expect(home.status).toBe("ok");
  expect(home.passed).toBe(true);            // identical → passes
  expect(about.passed).toBe(false);          // changed background+text → fails
  expect(about.diffScore!).toBeGreaterThan(home.diffScore!);
});
