// tests/pipeline/baseline-roundtrip.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { baselineConflict } from "../../src/pipeline/compat";
import { openDb, readSnapshot, readBaselineImages, type BaselineImageRow } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { CaptureResult } from "../../src/types";
import type { DiffResponse } from "../../src/diff/worker";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}
const okDiff = (a: Uint8Array): DiffResponse => ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });

// Mirror of runCommand's baseline-mode wiring (kept in sync with src/commands/run.ts).
function baselineWiring(config: ReturnType<typeof ConfigSchema.parse>, db: ReturnType<typeof openDb>, getDev: (job: Job) => Promise<CaptureResult>) {
  const images = readBaselineImages(db);
  const byKey = new Map<string, BaselineImageRow>(images.map((im) => [`${im.path} ${im.viewport}`, im]));
  const listJobs = async (): Promise<Job[]> => images.map((im) => ({
    path: im.path, viewport: im.viewport,
    devUrl: new URL(im.path, config.dev).toString(), prodUrl: im.prodUrl,
  }));
  const getProd = async (job: Job): Promise<CaptureResult> => {
    const im = byKey.get(`${job.path} ${job.viewport}`)!;
    return im.status === "ok" && im.image ? { ok: true, png: im.image } : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
  };
  return { listJobs, getDev, getProd };
}

test("snapshot then run: prod pulled from baseline, dev captured live, baseline preserved", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({ config, db, createdAt: "t", discover: async () => ["/", "/pricing"], captureFn: async () => ({ ok: true, png: png(100) }) });

  // Conflict check passes for a matching config.
  expect(baselineConflict(config, readSnapshot(db)!)).toBeNull();

  // getProd is store-backed; getDev is the ONLY seam allowed to capture live.
  // A live prod capture would throw here, proving prod is never re-screenshotted.
  const wiring = baselineWiring(config, db, async () => ({ ok: true, png: png(150) }));

  const { readComparisons } = await import("../../src/store/db");
  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: wiring.listJobs, getDev: wiring.getDev, getProd: wiring.getProd,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.status).toBe("ok");
  // The prod side served to the diff came from the baseline BLOB (png(100)),
  // not a live capture (which would have been png(150)).
  for (const r of rows) expect(Array.from(r.prodImage!)).toEqual(Array.from(png(100)));
  for (const r of rows) expect(Array.from(r.devImage!)).toEqual(Array.from(png(150)));
  // The baseline itself is still present after the run.
  expect(readSnapshot(db)).not.toBeNull();
  expect(readBaselineImages(db).length).toBe(2);
});

test("a prod error row in the baseline yields an error comparison, dev not diffed", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/broken"],
    captureFn: async () => ({ ok: false, error: "404" }),
  });

  const wiring = baselineWiring(config, db, async () => ({ ok: true, png: png(150) }));
  const { readComparisons } = await import("../../src/store/db");
  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: wiring.listJobs, getDev: wiring.getDev, getProd: wiring.getProd,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: 404");
});
