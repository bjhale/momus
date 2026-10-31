// tests/e2e/flake.integration.test.ts
// RFC-0006's flake benchmark: a fixture site with known nondeterminism, run
// many times against itself. Stabilized, no run may fail at failScore 0; the
// control proves the site really is nondeterministic, so the zero means
// something.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { PNG } from "pngjs";
import { launchBrowser } from "../../src/capture/browser";
import { captureSeams } from "../../src/commands/capture-seams";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons } from "../../src/store/db";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema, type RawConfig } from "../../src/config/schema";
import { launchable } from "../helpers/engines";

const installed = await launchable("chromium");
const maybe = installed ? test : test.skip;
const RUNS = 5;

const PHOTO = PNG.sync.write(Object.assign(new PNG({ width: 120, height: 400 }), {
  data: Buffer.alloc(120 * 400 * 4, Buffer.from([30, 120, 200, 255])),
}));

// Every kind of nondeterminism the RFC names, one per element.
const SITE = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px sans-serif; }
  @keyframes slide { from { margin-left: 0 } to { margin-left: 200px } }
  .css-anim { width: 40px; height: 40px; background: #c33; animation: slide 2s linear infinite; }
  .js-anim { position: relative; width: 40px; height: 40px; background: #3c3; }
</style></head><body>
  <div class="ab" id="ab" style="height:40px">A/B banner</div>
  <p id="posted"></p>
  <div class="css-anim"></div>
  <div class="js-anim" id="js"></div>
  <div style="height:2400px"></div>
  <img loading="lazy" src="/photo.png" style="display:block">
  <script>
    document.getElementById("ab").style.background = "hsl(" + Math.floor(Math.random() * 360) + ",70%,60%)";
    document.getElementById("posted").textContent = "Posted at " + new Date().toISOString();
    // A JS animation that, like a well-behaved site, honors reduced motion.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const el = document.getElementById("js");
      (function tick() { el.style.left = (performance.now() / 4 % 300) + "px"; requestAnimationFrame(tick); })();
    }
  </script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
let browser: Awaited<ReturnType<typeof launchBrowser>>;
beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/photo.png") {
        await Bun.sleep(Math.random() * 300);
        return new Response(new Uint8Array(PHOTO), { headers: { "content-type": "image/png" } });
      }
      return new Response(SITE, { headers: { "content-type": "text/html" } });
    },
  });
  if (installed) browser = await launchBrowser();
});
afterAll(async () => {
  await server.stop(true);
  await browser?.close();
});

/** Snapshot once, then RUNS runs of the same site against that baseline.
 * Returns each run's failed comparison count. */
async function benchmark(stabilize: RawConfig["stabilize"]): Promise<number[]> {
  const origin = `http://localhost:${server.port}`;
  const config = ConfigSchema.parse({
    dev: origin, prod: origin, viewports: [375],
    stabilize, diff: { failScore: 0 },
  });
  const db = openDb(":memory:");
  const pool = new DiffPool(1);
  const failures: number[] = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      const res = await runFlow({
        config, db, now: `2026-10-18T00:00:0${i}Z`,
        discover: async () => ["/"],
        ...captureSeams(browser, config),
        diffPool: pool,
      });
      if (!res.ok) throw new Error(res.conflict);
      const rows = readComparisons(db, res.runId);
      expect(rows.map((r) => r.status)).toEqual(["ok"]);
      failures.push(rows.filter((r) => !r.passed).length);
    }
  } finally {
    await pool.close();
    db.close();
  }
  return failures;
}

maybe("stabilized: zero false failures across repeated runs", async () => {
  const failures = await benchmark({ clock: "2026-01-01T00:00:00Z", mask: [".ab"] });
  expect(failures).toEqual(Array(RUNS).fill(0));
}, 120_000);

maybe("control: without stabilization the same site fails", async () => {
  const failures = await benchmark({
    reducedMotion: "no-preference", waitForImages: false, disableAnimations: false, settleMs: 0,
  });
  expect(failures.some((n) => n > 0)).toBe(true);
}, 120_000);
