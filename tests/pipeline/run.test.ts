// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { openDb, readComparisons } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";

function png(w: number, h: number, v: number): Uint8Array {
  const p = new PNG({ width: w, height: h }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

const okDiff = (a: Uint8Array): DiffResponse =>
  ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });

function runStatus(db: ReturnType<typeof openDb>): string {
  const row = db.query("SELECT status FROM runs WHERE id = 1").get() as { status: string } | null;
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
      submit: async (a: Uint8Array, _b: Uint8Array, threshold: number) => { thresholds.push(threshold); return okDiff(a); },
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
