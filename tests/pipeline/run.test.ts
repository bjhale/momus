// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline, configHash, type Job } from "../../src/pipeline/run";
import { openDb, readComparisons, readRun } from "../../src/store/db";
import { MOMUS_VERSION } from "../../src/version";
import { exitCodeFor } from "../../src/pipeline/verdict";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";
import type { DiffOptions } from "../../src/diff/diff";

function png(w: number, h: number, v: number): Uint8Array {
  const p = new PNG({ width: w, height: h }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

const okDiff = (a: Uint8Array): DiffResponse =>
  ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });

function runStatus(db: ReturnType<typeof openDb>): string {
  const row = db.query("SELECT status FROM runs ORDER BY id DESC LIMIT 1").get() as { status: string } | null;
  return row!.status;
}

// Build path×viewport jobs the way both run modes do.
function jobs(paths: string[], viewports: number[]): Job[] {
  return paths.flatMap((path) => viewports.map((viewport) => ({
    path, viewport,
    devUrl: `https://dev.example.com${path}`,
    prodUrl: `https://www.example.com${path}`,
  })));
}

const okPng = async () => ({ ok: true as const, png: png(4, 4, 100) });

test("pipeline captures, diffs, and persists for each path×viewport", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
    listJobs: async () => jobs(["/", "/pricing"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.status).toBe("ok");
  expect(runStatus(db)).toBe("complete");
});

test("capture-error branch records status=error with dev: prefix", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => ({ ok: false, error: "boom" }),
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("dev: boom");
  expect(runStatus(db)).toBe("complete");
});

test("prod-error branch records status=error with prod: prefix", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng,
    getProd: async () => ({ ok: false, error: "gone" }),
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: gone");
});

test("diff-error branch records status=error mentioning the diff failure", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (): Promise<DiffResponse> => ({ id: 1, ok: false, error: "diff boom" }), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("diff boom");
});

test("multi-viewport fan-out produces path×viewport rows", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/", "/pricing"], [375, 1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  expect(readComparisons(db, 1).length).toBe(4);
});

test("passes each side's url and the diff threshold through", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], diff: { threshold: 0.42 } });
  const db = openDb(":memory:");

  const devUrls: string[] = [];
  const prodUrls: string[] = [];
  const thresholds: number[] = [];

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/pricing"], [1280]),
    getDev: async (job) => { devUrls.push(job.devUrl); return { ok: true, png: png(4, 4, 100) }; },
    getProd: async (job) => { prodUrls.push(job.prodUrl); return { ok: true, png: png(4, 4, 100) }; },
    diffPool: {
      submit: async (a: Uint8Array, _b: Uint8Array, opts: DiffOptions) => { thresholds.push(opts.threshold); return okDiff(a); },
      close: async () => {},
    },
  });

  expect(devUrls).toContain("https://dev.example.com/pricing");
  expect(prodUrls).toContain("https://www.example.com/pricing");
  expect(thresholds).toEqual([0.42]);
});

test("a thrown getDev for one job does not abort the run", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/boom", "/ok"], [1280]),
    getDev: async (job) => { if (job.path === "/boom") throw new Error("kaboom"); return { ok: true, png: png(4, 4, 100) }; },
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  expect(rows.find((r) => r.path === "/boom")!.status).toBe("error");
  expect(rows.find((r) => r.path === "/boom")!.error).toContain("kaboom");
  expect(rows.find((r) => r.path === "/ok")!.status).toBe("ok");
  expect(runStatus(db)).toBe("complete");
});

test("listJobs throwing marks the run failed and propagates", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await expect(runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => { throw new Error("no pages discovered"); },
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  })).rejects.toThrow("no pages discovered");

  expect(runStatus(db)).toBe("failed");
});

test("prodBaseUrl arg overrides the run row's prod_base_url", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    prodBaseUrl: "https://frozen.example.com",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://frozen.example.com");
});

test("without prodBaseUrl the run row falls back to config.prod", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://www.example.com");
});

import type { Progress } from "../../src/progress";

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("runPipeline reports progress: start(total), tick per job, stop", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/", "/x"], [375, 1280]), // 4 jobs
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
    progress: p,
  });

  expect(rec.starts).toEqual([{ total: 4, label: "Capturing dev + diffing" }]);
  expect(rec.ticks).toBe(4);
  expect(rec.stops).toBe(1);
});

test("runPipeline ticks even for error jobs", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/ok", "/boom"], [1280]),
    getDev: async (job) => { if (job.path === "/boom") throw new Error("x"); return { ok: true, png: png(4, 4, 100) }; },
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
    progress: p,
  });

  expect(rec.ticks).toBe(2); // both the ok job and the throwing job ticked
  expect(rec.stops).toBe(1);
});

const cfg1280 = () => ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
const pool = { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} };
const never = async (): Promise<never> => { throw new Error("must not be called"); };

test("target identity on a job is persisted on its comparison", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg1280(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => [{ targetId: "scenarios:nav", source: "scenarios", label: "Nav", path: "/",
      viewport: 1280, devUrl: "https://dev.example.com/", prodUrl: "https://www.example.com/" }],
    getDev: okPng, getProd: okPng, diffPool: pool,
  });
  const r = readComparisons(db, 1)[0]!;
  expect([r.targetId, r.source, r.label, r.status]).toEqual(["scenarios:nav", "scenarios", "Nav", "ok"]);
});

test("action error: no capture, error row with the job's message", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg1280(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => [{ path: "/", viewport: 1280, devUrl: "", prodUrl: "", action: "error", error: "recipe changed" }],
    getDev: never, getProd: never, diffPool: pool,
  });
  const r = readComparisons(db, 1)[0]!;
  expect([r.status, r.error]).toEqual(["error", "recipe changed"]);
});

test("action added: captures dev only, stores it with status added", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg1280(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => [{ path: "/new", viewport: 1280, devUrl: "https://dev.example.com/new", prodUrl: "", action: "added" }],
    getDev: okPng, getProd: never, diffPool: pool,
  });
  const r = readComparisons(db, 1)[0]!;
  expect(r.status).toBe("added");
  expect(r.devImage).toBeInstanceOf(Uint8Array);
  expect(r.passed).toBeUndefined();
});

test("action added with a failing dev capture is an error", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg1280(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => [{ path: "/new", viewport: 1280, devUrl: "x", prodUrl: "", action: "added" }],
    getDev: async () => ({ ok: false, error: "boom" }), getProd: never, diffPool: pool,
  });
  const r = readComparisons(db, 1)[0]!;
  expect([r.status, r.error]).toEqual(["error", "dev: boom"]);
});

test("action removed: reads the baseline only, stores it with status removed", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg1280(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => [{ path: "/gone", viewport: 1280, devUrl: "", prodUrl: "https://www.example.com/gone", action: "removed" }],
    getDev: never, getProd: okPng, diffPool: pool,
  });
  const r = readComparisons(db, 1)[0]!;
  expect(r.status).toBe("removed");
  expect(r.prodImage).toBeInstanceOf(Uint8Array);
});

test("runPipeline returns the new run id and records provenance", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], browser: "firefox", diff: { allowAdded: true } });
  const db = openDb(":memory:");
  const id = await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    engineVersion: "140.0", baseline: { id: 3, identityJson: '{"b":1}' }, ci: { commit: "abc", pr: "7" },
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });
  const run = readRun(db, id)!;
  expect(run.momusVersion).toBe(MOMUS_VERSION);
  expect([run.engine, run.engineVersion, run.configHash]).toEqual(["firefox", "140.0", configHash(config)]);
  expect([run.baselineId, run.baselineJson]).toEqual([3, '{"b":1}']);
  expect([run.allowAdded, run.allowRemoved]).toEqual([true, false]);
  expect(run.ci).toEqual({ commit: "abc", pr: "7" });
});

test("a second runPipeline keeps the first run's rows", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const args = {
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]), getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  };
  const a = await runPipeline(args);
  const b = await runPipeline(args);
  expect(b).toBeGreaterThan(a);
  expect(readComparisons(db, a).length).toBe(1);
  expect(readComparisons(db, b).length).toBe(1);
});

test("a compared row stores the failScore that applied, including overrides", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280],
    diff: { failScore: 0.01, overrides: [{ path: "/blog/**", failScore: 0.2 }] },
  });
  const db = openDb(":memory:");
  const id = await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/", "/blog/x"], [1280]), getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });
  const byPath = Object.fromEntries(readComparisons(db, id).map((r) => [r.path, r.failScore]));
  expect(byPath).toEqual({ "/": 0.01, "/blog/x": 0.2 });
});

// Rebuild every plain object with its keys reversed, at every depth.
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).reverse().map((k) => [k, reverseKeys(o[k])]));
  }
  return v;
}

test("configHash ignores key order", () => {
  const a = ConfigSchema.parse({ dev: "https://d.example.com", prod: "https://p.example.com", viewports: [1] });
  const b = reverseKeys(a) as typeof a;
  expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
  expect(configHash(b)).toBe(configHash(a));
  expect(configHash(a)).toMatch(/^[0-9a-f]{64}$/);
});

// --- RFC-0006: one-sided images, sizes and regions, retries ---

const cfg06 = (over: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], ...over });
const noDiff = { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} };

test("a failed prod capture keeps the dev image on the error row", async () => {
  const db = openDb(":memory:");
  const devPng = png(4, 4, 10);
  await runPipeline({
    config: cfg06(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => ({ ok: true, png: devPng }),
    getProd: async () => ({ ok: false, error: "HTTP 404" }),
    diffPool: noDiff,
  });
  const [r] = readComparisons(db, 1);
  expect(r!.status).toBe("error");
  expect(Array.from(r!.devImage!)).toEqual(Array.from(devPng));
  expect(r!.prodImage).toBeUndefined();
});

test("a failed dev capture keeps the prod image on the error row", async () => {
  const db = openDb(":memory:");
  const prodPng = png(4, 4, 20);
  await runPipeline({
    config: cfg06(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => ({ ok: false, error: "timeout" }),
    getProd: async () => ({ ok: true, png: prodPng }),
    diffPool: noDiff,
  });
  const [r] = readComparisons(db, 1);
  expect(r!.status).toBe("error");
  expect(Array.from(r!.prodImage!)).toEqual(Array.from(prodPng));
  expect(r!.devImage).toBeUndefined();
});

test("a compared row stores each side's size and the change regions", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg06(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: {
      submit: async (a: Uint8Array) => ({
        ...okDiff(a), aWidth: 4, aHeight: 6, bWidth: 3, bHeight: 4,
        regions: [{ x: 0, y: 4, width: 4, height: 2 }], regionCount: 9,
      }),
      close: async () => {},
    },
  });
  const [r] = readComparisons(db, 1);
  expect([r!.devWidth, r!.devHeight, r!.prodWidth, r!.prodHeight]).toEqual([4, 6, 3, 4]);
  expect(r!.regions).toEqual([{ x: 0, y: 4, width: 4, height: 2 }]);
  expect(r!.regionCount).toBe(9);
  expect(r!.retries).toBe(0);
});

/** A pool whose successive diffs score from `scores`, one per call. */
function scoring(scores: number[]) {
  let i = 0;
  return {
    submit: async (a: Uint8Array): Promise<DiffResponse> => ({ ...okDiff(a), diffScore: scores[i++] ?? 0 }),
    close: async () => {},
  };
}

test("retries re-captures dev until it passes, and records how many", async () => {
  const db = openDb(":memory:");
  let devCalls = 0;
  await runPipeline({
    config: cfg06({ retries: 2 }), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => { devCalls++; return okPng(); }, getProd: okPng,
    diffPool: scoring([0.5, 0.5, 0]),
  });
  const [r] = readComparisons(db, 1);
  expect(devCalls).toBe(3);
  expect(r!.passed).toBe(true);
  expect(r!.retries).toBe(2);
});

test("retries fail the target only when every attempt fails", async () => {
  const db = openDb(":memory:");
  let devCalls = 0;
  await runPipeline({
    config: cfg06({ retries: 2 }), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => { devCalls++; return okPng(); }, getProd: okPng,
    diffPool: scoring([0.5, 0.5, 0.5, 0.5]),
  });
  const [r] = readComparisons(db, 1);
  expect(devCalls).toBe(3);
  expect(r!.passed).toBe(false);
  expect(r!.retries).toBe(2);
});

test("retries cover a dev capture error", async () => {
  const db = openDb(":memory:");
  let devCalls = 0;
  await runPipeline({
    config: cfg06({ retries: 2 }), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => (++devCalls === 1 ? { ok: false, error: "timeout" } : okPng()), getProd: okPng,
    diffPool: noDiff,
  });
  const [r] = readComparisons(db, 1);
  expect(r!.status).toBe("ok");
  expect(r!.error).toBeUndefined();
  expect(r!.retries).toBe(1);
});

test("a baseline (prod) error is never retried", async () => {
  const db = openDb(":memory:");
  let devCalls = 0;
  await runPipeline({
    config: cfg06({ retries: 3 }), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => { devCalls++; return okPng(); },
    getProd: async () => ({ ok: false, error: "prod capture failed in snapshot" }),
    diffPool: noDiff,
  });
  const [r] = readComparisons(db, 1);
  expect(devCalls).toBe(1);
  expect(r!.status).toBe("error");
  expect(r!.retries).toBe(0);
});

// --- Final review: unstable covers only the regions that moved in the baseline ---

const moving = [{ x: 0, y: 0, width: 50, height: 20 }];
function regionPool(regions: Array<{ x: number; y: number; width: number; height: number }>, score = 0.5) {
  return {
    submit: async (a: Uint8Array): Promise<DiffResponse> =>
      ({ ...okDiff(a), diffPixels: 9, diffScore: score, regions, regionCount: regions.length }),
    close: async () => {},
  };
}
const unstableProd = async () => ({ ok: true as const, png: png(4, 4, 100), unstableRegions: moving });

test("changes only where the baseline moves: unstable, not failing", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg06(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: unstableProd,
    diffPool: regionPool([{ x: 10, y: 5, width: 5, height: 5 }]),
  });
  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("unstable");
  expect(exitCodeFor(rows)).toBe(0);
});

test("a change outside the moving regions is gated as usual, unstable regions still shown", async () => {
  const db = openDb(":memory:");
  await runPipeline({
    config: cfg06(), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: unstableProd,
    diffPool: regionPool([{ x: 10, y: 5, width: 5, height: 5 }, { x: 400, y: 900, width: 300, height: 200 }]),
  });
  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("ok");
  expect(rows[0]!.passed).toBe(false);
  expect(rows[0]!.unstableRegions).toEqual(moving);
  expect(exitCodeFor(rows)).toBe(1);
});

test("a change outside the moving regions is retried like any failure", async () => {
  const db = openDb(":memory:");
  let devCalls = 0;
  await runPipeline({
    config: cfg06({ retries: 2 }), db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => { devCalls++; return okPng(); }, getProd: unstableProd,
    diffPool: regionPool([{ x: 400, y: 900, width: 300, height: 200 }]),
  });
  expect(devCalls).toBe(3);
  expect(readComparisons(db, 1)[0]!.retries).toBe(2);
});
