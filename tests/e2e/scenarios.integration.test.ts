// tests/e2e/scenarios.integration.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { launchBrowser } from "../../src/capture/browser";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons, readBaselineImages, readSnapshot, latestRunId } from "../../src/store/db";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema } from "../../src/config/schema";
import { captureSeams } from "../../src/commands/capture-seams";
import { scenariosSource } from "../../src/targets/scenarios";
import { launchable, TEST_ENGINES } from "../helpers/engines";

const LOGIN = (error = "") => `<html><body><form method="post" action="/login">${error}
  <input id="email" name="email"><input id="password" name="password" type="password">
  <button type="submit">Log in</button></form></body></html>`;
const APP = `<html><head><style>nav[data-open]{display:block !important}</style></head><body>
  <button aria-label="Menu" onclick="document.querySelector('nav').dataset.open=''">Menu</button>
  <nav style="display:none;width:300px;height:120px;background:#369"></nav></body></html>`;
const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { "content-type": "text/html", ...(init.headers as object) } });

// Same markup for every user, so dev and prod render identically and only the
// credentials differ.
function site(user: string, pass: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const authed = (req.headers.get("cookie") ?? "").includes("session=ok");
      if (req.method === "POST" && url.pathname === "/login") {
        const form = await req.formData();
        if (form.get("email") === user && form.get("password") === pass) {
          return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "session=ok; Path=/" } });
        }
        return html(LOGIN("<p class=error>bad credentials</p>"));
      }
      if (url.pathname === "/login" || !authed) return html(LOGIN());
      return url.pathname === "/" ? html(APP) : new Response("not found", { status: 404 });
    },
  });
}

const login = (email: string, password: string) => ({
  steps: [
    { goto: "/login" }, { fill: ["#email", email] }, { fill: ["#password", password] },
    { click: "button[type=submit]" }, { waitFor: "button[aria-label=Menu]" },
  ],
});

const NAV = { id: "nav-open", path: "/", steps: [{ click: "button[aria-label=Menu]" }, { waitFor: "nav[data-open]" }], capture: { element: "nav" } };

for (const engine of TEST_ENGINES) {
  const maybe = (await launchable(engine)) ? test : test.skip;

  async function withSites<T>(prodPass: string, scenarios: unknown[], timeoutMs: number,
    fn: (a: { run: () => ReturnType<typeof runFlow>; db: ReturnType<typeof openDb> }) => Promise<T>) {
    const dev = site("alice", "devpass");
    const prod = site("bob", "prodpass");
    const config = ConfigSchema.parse({
      dev: `http://localhost:${dev.port}`, prod: `http://localhost:${prod.port}`,
      browser: engine, viewports: [1280],
      stabilize: { waitUntil: "load", settleMs: 0, timeoutMs },
      setup: { dev: login("alice", "devpass"), prod: login("bob", prodPass) },
      scenarios,
    });
    const db = openDb(":memory:");
    const browser = await launchBrowser(engine);
    const diffPool = new DiffPool(2);
    try {
      return await fn({
        db,
        run: () => runFlow({
          config, db, now: "2026-10-17T10:00:00Z", discover: async () => ["/"],
          sources: [scenariosSource(config)], diffPool, ...captureSeams(browser, config),
        }),
      });
    } finally {
      await diffPool.close(); await browser.close(); dev.stop(); prod.stop();
    }
  }

  maybe(`[${engine}] logs in per side, runs a scenario, captures the element`, async () => {
    await withSites("prodpass", [NAV], 5000, async ({ run, db }) => {
      const res = await run();
      expect(res.ok).toBe(true);
      const rows = readComparisons(db, latestRunId(db)!);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) { expect(r.error).toBeUndefined(); expect(r.status).toBe("ok"); expect(r.passed).toBe(true); }
      const img = readBaselineImages(db).find((b) => b.targetId === "scenarios:nav-open")!;
      const png = PNG.sync.read(Buffer.from(img.image!));
      expect([png.width, png.height]).toEqual([300, 120]);
    });
  });

  maybe(`[${engine}] a wrong prod password is an operational failure that hides the password`, async () => {
    await withSites("wrong", [NAV], 1000, async ({ run, db }) => {
      const err = await run().catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message.startsWith('setup (prod) step 5: waitFor "button[aria-label=Menu]"')).toBe(true);
      expect(err.message).not.toContain("wrong");
      expect(readSnapshot(db)).toBeNull();
    });
  });

  maybe(`[${engine}] a missing element is a per-target error row`, async () => {
    await withSites("prodpass", [NAV, { id: "missing", path: "/", capture: { element: "#nope" } }], 5000, async ({ run, db }) => {
      const res = await run();
      expect(res.ok).toBe(true);
      const rows = readComparisons(db, latestRunId(db)!);
      const bad = rows.filter((r) => r.targetId === "scenarios:missing");
      expect(bad.length).toBeGreaterThan(0);
      for (const r of bad) { expect(r.status).toBe("error"); expect(r.error).toContain("matched nothing"); }
      for (const r of rows.filter((r) => r.targetId !== "scenarios:missing")) expect(r.status).toBe("ok");
    });
  });
}
