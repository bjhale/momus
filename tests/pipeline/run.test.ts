// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline } from "../../src/pipeline/run";
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

test("pipeline captures, diffs, and persists for each path×viewport", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
    // Inject fakes for the browser-touching + discovery seams:
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: {
      submit: async (a: Uint8Array) => okDiff(a),
      close: async () => {},
    },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2); // 2 paths × 1 viewport
  for (const r of rows) expect(r.status).toBe("ok");
  expect(runStatus(db)).toBe("complete");
});

test("capture-error branch records status=error with dev: prefix", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => ["/"],
    // Dev side fails, prod side succeeds.
    captureFn: async (url) =>
      url.startsWith("https://dev.")
        ? { ok: false, error: "boom" }
        : { ok: true, png: png(4, 4, 100) },
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("dev: boom");
  expect(runStatus(db)).toBe("complete");
});

test("diff-error branch records status=error mentioning the diff failure", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => ["/"],
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: {
      submit: async (): Promise<DiffResponse> => ({ id: 1, ok: false, error: "diff boom" }),
      close: async () => {},
    },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("diff boom");
});

test("multi-viewport fan-out produces path×viewport rows", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [375, 1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(4); // 2 paths × 2 viewports
});

test("joins URLs correctly and passes diff threshold through", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280], diff: { threshold: 0.42 },
  });
  const db = openDb(":memory:");

  const captureUrls: string[] = [];
  const diffThresholds: number[] = [];

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => ["/pricing"],
    captureFn: async (url) => { captureUrls.push(url); return { ok: true, png: png(4, 4, 100) }; },
    diffPool: {
      submit: async (a: Uint8Array, _b: Uint8Array, threshold: number) => {
        diffThresholds.push(threshold); return okDiff(a);
      },
      close: async () => {},
    },
  });

  expect(captureUrls).toContain("https://dev.example.com/pricing");
  expect(captureUrls).toContain("https://www.example.com/pricing");
  expect(diffThresholds).toEqual([0.42]);
});

test("a thrown capture for one job does not abort the run", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => ["/boom", "/ok"],
    // Throw (not return {ok:false}) for the /boom path; succeed for /ok.
    captureFn: async (url) => {
      if (url.includes("/boom")) throw new Error("kaboom");
      return { ok: true, png: png(4, 4, 100) };
    },
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  const boom = rows.find((r) => r.path === "/boom")!;
  const ok = rows.find((r) => r.path === "/ok")!;
  expect(boom.status).toBe("error");
  expect(boom.error).toContain("kaboom");
  expect(ok.status).toBe("ok");
  // One bad page must not abort the run.
  expect(runStatus(db)).toBe("complete");
});

test("discover() throwing marks the run failed and propagates", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await expect(runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    discover: async () => { throw new Error("no pages discovered"); },
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  })).rejects.toThrow("no pages discovered");

  expect(runStatus(db)).toBe("failed");
});
