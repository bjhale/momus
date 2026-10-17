// tests/store/fixture-v0.9.4.test.ts
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { openDb as openDbRaw, readSnapshot, readBaselineImages, readComparisons } from "../../src/store/db";
import { LATEST_VERSION, userVersion } from "../../src/store/migrations";
import { writeReport } from "../../src/report/report";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema } from "../../src/config/schema";
import { exitCodeFor } from "../../src/pipeline/verdict";
import type { DiffResponse } from "../../src/diff/worker";

const FIXTURE = join(import.meta.dir, "../fixtures/db/v0.9.4.sqlite");

let dir = "";
const opened: Database[] = [];
const openDb = (path: string): Database => { const d = openDbRaw(path); opened.push(d); return d; };
afterEach(() => {
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
/** Migration writes, so every test works on a copy. */
function copy(): string {
  dir = mkdtempSync(join(import.meta.dir, ".tmp-fixture-"));
  const file = join(dir, "momus.sqlite");
  copyFileSync(FIXTURE, file);
  return file;
}

// The config the fixture was captured with (see make-v0.9.4.ts).
const config = ConfigSchema.parse({
  dev: "http://localhost:47802", prod: "http://localhost:47801", viewports: [375],
  stabilize: { waitUntil: "load", settleMs: 0 },
  discovery: { urlList: "urls.txt", sitemap: false },
});

test("the v0.9.4 fixture migrates to the latest version", () => {
  const db = openDb(copy());
  expect(userVersion(db)).toBe(LATEST_VERSION);
  const images = readBaselineImages(db);
  expect(images.map((im) => [im.targetId, im.source, im.label, im.viewport, im.status]))
    .toEqual([["/", "pages", "/", 375, "ok"], ["/about", "pages", "/about", 375, "ok"]]);
  expect(readSnapshot(db)!.prodBaseUrl).toBe("http://localhost:47801");
});

test("the v0.9.4 run survives migration", () => {
  const db = openDb(copy());
  const rows = readComparisons(db, 1);
  expect(rows.map((r) => [r.targetId, r.passed]).sort()).toEqual([["/", true], ["/about", false]]);
});

test("the v0.9.4 baseline diffs unchanged: dev identical to the baseline passes everywhere", async () => {
  const db = openDb(copy());
  const before = readBaselineImages(db);
  const byPath = new Map(before.map((im) => [im.path, im.image!]));
  // Diff as identity: identical inputs score 0. No worker threads needed.
  const diffPool = {
    submit: async (a: Uint8Array): Promise<DiffResponse> =>
      ({ id: 1, ok: true, width: 1, height: 1, diffPixels: 0, diffScore: 0, diffPng: a }),
    close: async () => {},
  };
  const res = await runFlow({
    config, db, now: "2026-10-17T00:00:00Z",
    discover: async () => { throw new Error("a frozen baseline must not rediscover"); },
    readUrlList: async () => "/\n/about\n",
    captureProd: async () => { throw new Error("a frozen baseline must not recapture prod"); },
    getDev: async (job) => ({ ok: true, png: byPath.get(job.path)! }),
    diffPool,
  });
  expect(res.ok).toBe(true);
  const after = readBaselineImages(db);
  expect(after.map((im) => Array.from(im.image!))).toEqual(before.map((im) => Array.from(im.image!)));
  const latest = (db.query("SELECT max(id) AS id FROM runs").get() as { id: number }).id;
  const rows = readComparisons(db, latest);
  expect(rows.length).toBe(2);
  expect(exitCodeFor(rows)).toBe(0);
});

test("the migrated v0.9.4 run renders as a report", async () => {
  const db = openDb(copy());
  const out = join(dir, "report.html");
  await writeReport(db, 1, out);
  const html = await Bun.file(out).text();
  expect(html).toContain("run #1");
  expect(html).toContain(">/about<");
});
