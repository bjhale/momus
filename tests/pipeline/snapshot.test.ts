// tests/pipeline/snapshot.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { openDb, readSnapshot, readBaselineImages } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

test("snapshotPipeline captures prod and writes baseline tables", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "2026-07-04T00:00:00Z",
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(100) }),
  });

  const rows = readBaselineImages(db);
  expect(rows.length).toBe(4); // 2 paths × 2 viewports
  for (const r of rows) { expect(r.status).toBe("ok"); expect(r.image).toBeInstanceOf(Uint8Array); }

  const snap = readSnapshot(db)!;
  expect(snap.prodBaseUrl).toBe("https://www.example.com");
  expect(snap.viewports).toEqual([375, 1280]);
  expect(rows.some((r) => r.prodUrl === "https://www.example.com/pricing")).toBe(true);
});

test("a failed prod capture is stored as an error row, snapshot still written", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/broken"],
    captureFn: async (url) => url.includes("/broken") ? { ok: false, error: "404" } : { ok: true, png: png(100) },
  });

  const rows = readBaselineImages(db);
  const broken = rows.find((r) => r.path === "/broken")!;
  expect(broken.status).toBe("error");
  expect(broken.error).toContain("404");
  expect(broken.image).toBeUndefined();
  expect(readSnapshot(db)).not.toBeNull();
});

test("discovery failure leaves any prior baseline intact and propagates", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  // Seed a prior baseline.
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  expect(readBaselineImages(db).length).toBe(1);

  // A re-snapshot whose discovery throws must NOT wipe the existing baseline.
  await expect(snapshotPipeline({
    config, db, createdAt: "t2",
    discover: async () => { throw new Error("no pages discovered"); },
    captureFn: async () => ({ ok: true, png: png(50) }),
  })).rejects.toThrow("no pages discovered");

  expect(readBaselineImages(db).length).toBe(1); // old baseline preserved
  expect(readSnapshot(db)!.createdAt).toBe("t1");
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

test("snapshotPipeline reports progress: start('Capturing prod', total), tick per job, stop", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/pricing"], // 2 jobs
    captureFn: async () => ({ ok: true, png: png(100) }),
    progress: p,
  });

  expect(rec.starts).toEqual([{ total: 2, label: "Capturing prod" }]);
  expect(rec.ticks).toBe(2);
  expect(rec.stops).toBe(1);
});
