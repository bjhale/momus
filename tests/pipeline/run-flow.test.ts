// tests/pipeline/run-flow.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runFlow } from "../../src/pipeline/run-flow";
import { openDb, readComparisons, readSnapshot, readBaselineImages } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";
import type { Progress } from "../../src/progress";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}
const okDiff = (a: Uint8Array): DiffResponse => ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });
const diffPool = { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} };

function cfg(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], ...over });
}

test("no baseline: materializes one AND diffs in a single invocation", async () => {
  const db = openDb(":memory:");
  const res = await runFlow({
    config: cfg(), db, now: "2026-07-04T10:00:00Z",
    discover: async () => ["/", "/pricing"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  expect(res).toEqual({ ok: true, materialized: true, createdAt: "2026-07-04T10:00:00Z" });
  // Baseline materialized...
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://www.example.com");
  expect(readBaselineImages(db).length).toBe(2);
  // ...and comparisons produced in the same call, prod from the fresh baseline BLOB.
  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) { expect(r.status).toBe("ok"); expect(Array.from(r.prodImage!)).toEqual(Array.from(png(100))); }
});

test("second run freezes: no discovery, no prod re-capture, baseline reused", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const res = await runFlow({
    config: cfg(), db, now: "t2",
    discover: async () => { throw new Error("must not discover on a frozen baseline"); },
    captureProd: async () => { throw new Error("must not re-capture prod on a frozen baseline"); },
    getDev: async () => ({ ok: true, png: png(200) }),
    diffPool,
  });

  expect(res).toEqual({ ok: true, materialized: false, createdAt: "t1" });
  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("ok");
  // prod still the frozen baseline (png 100); dev is the new capture (png 200).
  expect(Array.from(rows[0]!.prodImage!)).toEqual(Array.from(png(100)));
  expect(Array.from(rows[0]!.devImage!)).toEqual(Array.from(png(200)));
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

test("run row records the baseline's prod URL, not the live config prod", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ prod: "https://frozen.example.com" }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const res = await runFlow({
    config: cfg({ prod: "https://live-different.example.com" }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  expect(res.ok).toBe(true);
  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://frozen.example.com");
});

test("conflict on changed viewports returns ok:false and skips the diff", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ viewports: [1280] }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  let devCalls = 0;
  const res = await runFlow({
    config: cfg({ viewports: [375] }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => { devCalls++; return { ok: true, png: png(150) }; },
    diffPool,
  });

  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.conflict.toLowerCase()).toContain("viewport");
  expect(devCalls).toBe(0); // diff never ran
});

test("a prod error row from materialize yields a prod: error comparison", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/broken"],
    captureProd: async () => ({ ok: false, error: "404" }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: 404");
});

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("runFlow drives two sequential phases on a materializing run", async () => {
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runFlow({
    config: cfg(), db, now: "t",
    discover: async () => ["/", "/pricing"], // 2 prod jobs (viewports [1280])
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool, progress: p,
  });

  expect(rec.starts.map((s) => s.label)).toEqual(["Capturing prod", "Capturing dev + diffing"]);
  expect(rec.starts.map((s) => s.total)).toEqual([2, 2]);
  expect(rec.ticks).toBe(4); // 2 prod + 2 dev
  expect(rec.stops).toBe(2);
});

test("runFlow drives one phase on a reused (frozen) baseline", async () => {
  const db = openDb(":memory:");
  // Materialize first WITHOUT progress.
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  // Second run reuses the baseline; only the dev phase runs.
  const { p, rec } = fakeProgress();
  await runFlow({
    config: cfg(), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool, progress: p,
  });

  expect(rec.starts.map((s) => s.label)).toEqual(["Capturing dev + diffing"]);
  expect(rec.stops).toBe(1);
});
