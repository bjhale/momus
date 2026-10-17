// tests/pipeline/run-flow.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runFlow } from "../../src/pipeline/run-flow";
import { ProdUnreachableError } from "../../src/pipeline/snapshot";
import { openDb, readComparisons, latestRunId, readSnapshot, readBaselineImages, readRun, listRunIds } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";
import type { Progress } from "../../src/progress";
import { exitCodeFor } from "../../src/pipeline/verdict";
import type { Target, TargetSource } from "../../src/targets/target";

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

  expect(res).toEqual({ ok: true, materialized: true, createdAt: "2026-07-04T10:00:00Z", runId: expect.any(Number) });
  // Baseline materialized...
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://www.example.com");
  expect(readBaselineImages(db).length).toBe(2);
  // ...and comparisons produced in the same call, prod from the fresh baseline BLOB.
  const rows = readComparisons(db, latestRunId(db)!);
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

  expect(res).toEqual({ ok: true, materialized: false, createdAt: "t1", runId: expect.any(Number) });
  const rows = readComparisons(db, latestRunId(db)!);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("ok");
  // prod still the frozen baseline (png 100); dev is the new capture (png 200).
  expect(Array.from(rows[0]!.prodImage!)).toEqual(Array.from(png(100)));
  expect(Array.from(rows[0]!.devImage!)).toEqual(Array.from(png(200)));
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

test("forceSnapshot: re-materializes even when a baseline exists (re-discovers + re-captures prod)", async () => {
  const db = openDb(":memory:");
  // First run materializes a baseline: one path, prod png(100).
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  // Second run with forceSnapshot:true must NOT freeze — it re-discovers and
  // re-captures prod, replacing the baseline entirely (new paths + new png 200).
  let discovered = false, prodCaptured = false;
  const res = await runFlow({
    config: cfg(), db, now: "t2", forceSnapshot: true,
    discover: async () => { discovered = true; return ["/", "/about"]; },
    captureProd: async () => { prodCaptured = true; return { ok: true, png: png(200) }; },
    getDev: async () => ({ ok: true, png: png(50) }),
    diffPool,
  });

  expect(res).toEqual({ ok: true, materialized: true, createdAt: "t2", runId: expect.any(Number) });
  expect(discovered).toBe(true);
  expect(prodCaptured).toBe(true);
  // Baseline replaced: now 2 paths, snapshot re-dated, prod BLOB is the new png.
  expect(readBaselineImages(db).length).toBe(2);
  expect(readSnapshot(db)!.createdAt).toBe("t2");
  const rows = readComparisons(db, latestRunId(db)!);
  expect(rows.length).toBe(2);
  for (const r of rows) expect(Array.from(r.prodImage!)).toEqual(Array.from(png(200)));
});

test("a live prod on another origin (config or --prod) conflicts instead of diffing", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ prod: "https://frozen.example.com" }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  let devCalls = 0;
  const res = await runFlow({
    config: cfg({ prod: "https://live-different.example.com" }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => { devCalls++; return { ok: true, png: png(150) }; },
    diffPool,
  });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.conflict).toContain("prod origin differs");
  expect(devCalls).toBe(0);
});

test("run row records the baseline's prod URL when the live prod is the same origin", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ prod: "https://frozen.example.com" }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  const res = await runFlow({
    config: cfg({ prod: "https://frozen.example.com/" }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  if (!res.ok) throw new Error(res.conflict);
  expect(readRun(db, res.runId)!.prodBaseUrl).toBe("https://frozen.example.com");
});

test("--snapshot with a new prod origin re-materializes instead of conflicting", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ prod: "https://one.example.com" }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  const res = await runFlow({
    config: cfg({ prod: "https://two.example.com" }), db, now: "t2", forceSnapshot: true,
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  expect(res.ok).toBe(true);
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://two.example.com");
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
  // One page fails, one succeeds: a partial failure still freezes (an all-error
  // capture is refused instead, see below).
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/broken", "/fine"],
    captureProd: async (url) => url.endsWith("/broken") ? { ok: false, error: "404" } : { ok: true, png: png(150) },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const rows = readComparisons(db, latestRunId(db)!);
  const broken = rows.find((r) => r.path === "/broken")!;
  expect(broken.status).toBe("error");
  expect(broken.error).toContain("prod: 404");
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

const devOk = async () => ({ ok: true as const, png: png(150) });
const prodOk = async () => ({ ok: true as const, png: png(100) });
const scenario = (id: string, extra: Partial<Target> = {}): Target => ({
  id, source: "scenarios", label: id, path: "/",
  url: { dev: "https://dev.example.com/", prod: "https://www.example.com/" }, ...extra,
});
/** A fake non-page source whose list can change between calls. */
function scenarios(list: () => Promise<Target[]>): TargetSource {
  return { name: "scenarios", listForSnapshot: list, listLive: list };
}
const byId = (db: ReturnType<typeof openDb>) =>
  Object.fromEntries(readComparisons(db, latestRunId(db)!).map((r) => [r.targetId, r]));

test("frozen run: a urlList entry missing from the baseline is added; discovery never runs", async () => {
  const db = openDb(":memory:");
  const config = cfg({ discovery: { urlList: "urls.txt", sitemap: false } });
  await runFlow({ config, db, now: "t1", discover: async () => ["/"], readUrlList: async () => "/\n",
    captureProd: prodOk, getDev: devOk, diffPool });

  await runFlow({ config, db, now: "t2",
    discover: async () => { throw new Error("must not discover on a frozen baseline"); },
    readUrlList: async () => "/\n/new\n",
    captureProd: async () => { throw new Error("must not capture prod"); },
    getDev: devOk, diffPool });

  const rows = byId(db);
  expect(rows["/"]!.status).toBe("ok");
  expect(rows["/new"]!.status).toBe("added");
  expect(rows["/new"]!.devImage).toBeInstanceOf(Uint8Array);
  expect(exitCodeFor(readComparisons(db, latestRunId(db)!))).toBe(1);
  expect(exitCodeFor(readComparisons(db, latestRunId(db)!), { allowAdded: true, allowRemoved: false })).toBe(0);
});

test("a page dropped from the urlList is still compared, never removed", async () => {
  const db = openDb(":memory:");
  const config = cfg({ discovery: { urlList: "urls.txt", sitemap: false } });
  await runFlow({ config, db, now: "t1", discover: async () => ["/", "/old"], readUrlList: async () => "/\n/old\n",
    captureProd: prodOk, getDev: devOk, diffPool });
  await runFlow({ config, db, now: "t2", discover: async () => [], readUrlList: async () => "/\n",
    captureProd: prodOk, getDev: devOk, diffPool });
  expect(byId(db)["/old"]!.status).toBe("ok");
});

test("a scenario gone from its source's live list is removed", async () => {
  const db = openDb(":memory:");
  let live = [scenario("scenarios:a"), scenario("scenarios:b")];
  const sources = [scenarios(async () => live)];
  await runFlow({ config: cfg(), db, now: "t1", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  live = [scenario("scenarios:a")];
  await runFlow({ config: cfg(), db, now: "t2", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  const rows = byId(db);
  expect(rows["scenarios:a"]!.status).toBe("ok");
  expect(rows["scenarios:b"]!.status).toBe("removed");
  expect(rows["scenarios:b"]!.prodImage).toBeInstanceOf(Uint8Array);
});

test("a source that fails to list: one error row, its targets skipped, pages still compared", async () => {
  const db = openDb(":memory:");
  let fail = false;
  const sources = [scenarios(async () => { if (fail) throw new Error("index.json unreachable"); return [scenario("scenarios:a")]; })];
  await runFlow({ config: cfg(), db, now: "t1", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  fail = true;
  await runFlow({ config: cfg(), db, now: "t2", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  const rows = byId(db);
  expect(Object.keys(rows).sort()).toEqual(["/", "source:scenarios"]); // no false "removed"
  expect(rows["source:scenarios"]!.error).toBe("could not list scenarios targets: index.json unreachable");
  expect(rows["/"]!.status).toBe("ok");
});

test("a live listing with invalid ids is one source error row, baseline rows skipped, pages compared", async () => {
  const db = openDb(":memory:");
  let bad = false;
  const sources = [scenarios(async () => [scenario(bad ? "bad" : "scenarios:a")])];
  await runFlow({ config: cfg(), db, now: "t1", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  bad = true;
  await runFlow({ config: cfg(), db, now: "t2", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  const rows = byId(db);
  expect(Object.keys(rows).sort()).toEqual(["/", "source:scenarios"]);
  expect(rows["source:scenarios"]!.status).toBe("error");
  expect(rows["source:scenarios"]!.error).toContain('must start with "scenarios:"');
  expect(rows["/"]!.status).toBe("ok");
});

test("an unreadable urlList on a frozen run is one pages source error", async () => {
  const db = openDb(":memory:");
  const config = cfg({ discovery: { urlList: "urls.txt", sitemap: false } });
  await runFlow({ config, db, now: "t1", discover: async () => ["/"], readUrlList: async () => "/\n",
    captureProd: prodOk, getDev: devOk, diffPool });
  await runFlow({ config, db, now: "t2", discover: async () => [],
    readUrlList: async () => { throw new Error("ENOENT: urls.txt"); },
    captureProd: prodOk, getDev: devOk, diffPool });
  const rows = readComparisons(db, latestRunId(db)!);
  expect(rows.map((r) => [r.targetId, r.status])).toEqual([["source:pages", "error"]]);
});

test("a changed recipe errors that target only", async () => {
  const db = openDb(":memory:");
  let recipe: Record<string, unknown> = { steps: 1 };
  const sources = [scenarios(async () => [scenario("scenarios:a", { recipe }), scenario("scenarios:b")])];
  await runFlow({ config: cfg(), db, now: "t1", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  recipe = { steps: 2 };
  const res = await runFlow({ config: cfg(), db, now: "t2", discover: async () => ["/"], sources,
    captureProd: prodOk, getDev: devOk, diffPool });
  expect(res.ok).toBe(true); // not a whole-run baseline conflict
  const rows = byId(db);
  expect(rows["scenarios:a"]!.status).toBe("error");
  expect(rows["scenarios:a"]!.error).toContain("recipe changed");
  expect(rows["scenarios:b"]!.status).toBe("ok");
  expect(rows["/"]!.status).toBe("ok");
});

test("runs accumulate across invocations and record the baseline they used", async () => {
  const db = openDb(":memory:");
  const go = (now: string) => runFlow({
    config: cfg(), db, now, engineVersion: "131.0",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  const r1 = await go("t1");
  const r2 = await go("t2");
  if (!r1.ok || !r2.ok) throw new Error("expected ok");
  expect(r2.runId).toBeGreaterThan(r1.runId);
  const snap = readSnapshot(db)!;
  const run = readRun(db, r2.runId)!;
  expect(run.baselineId).toBe(snap.id);
  expect(JSON.parse(run.baselineJson!)).toEqual({
    browser: "chromium", createdAt: "t1", id: snap.id, prodBaseUrl: "https://www.example.com",
    stabilize: snap.stabilize, viewports: [1280],
  });
  expect(run.engineVersion).toBe("131.0");
});

test("runFlow prunes to output.keepRuns after each run", async () => {
  const db = openDb(":memory:");
  const ids: number[] = [];
  for (const now of ["t1", "t2", "t3"]) {
    const r = await runFlow({
      config: cfg({ output: { keepRuns: 2 } }), db, now,
      discover: async () => ["/"],
      captureProd: async () => ({ ok: true, png: png(100) }),
      getDev: async () => ({ ok: true, png: png(150) }),
      diffPool,
    });
    if (!r.ok) throw new Error("expected ok");
    ids.push(r.runId);
  }
  expect(listRunIds(db)).toEqual(ids.slice(1));
});

test("a re-snapshot keeps earlier runs: each run holds its own prod images", async () => {
  const db = openDb(":memory:");
  const first = await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  await runFlow({
    config: cfg(), db, now: "t2", forceSnapshot: true,
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(200) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  if (!first.ok) throw new Error("expected ok");
  const [row] = readComparisons(db, first.runId);
  expect(Array.from(row!.prodImage!)).toEqual(Array.from(png(100)));
});

test("an all-error materialize doesn't freeze: no baseline, no run, ProdUnreachableError", async () => {
  const db = openDb(":memory:");
  await expect(runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: false, error: "ECONNREFUSED" }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  })).rejects.toBeInstanceOf(ProdUnreachableError);
  expect(readSnapshot(db)).toBeNull();
  expect(listRunIds(db)).toEqual([]);
});
