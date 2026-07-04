// tests/diff/pool.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { DiffPool } from "../../src/diff/pool";

function pngBuffer(w: number, h: number, v: number): Uint8Array {
  const png = new PNG({ width: w, height: h });
  png.data.fill(v);
  return new Uint8Array(PNG.sync.write(png));
}

test("pool processes more jobs than workers", async () => {
  const pool = new DiffPool(2);
  const jobs = Array.from({ length: 5 }, (_, i) =>
    pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, i * 10), 0.1));
  const results = await Promise.all(jobs);
  expect(results.length).toBe(5);
  for (const r of results) expect(r.ok).toBe(true);
  await pool.close();
});

test("close resolves all pending jobs instead of hanging", async () => {
  const pool = new DiffPool(2);
  const jobs = Array.from({ length: 6 }, (_, i) =>
    pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, i * 10), 0.1));
  // Close immediately: some jobs are in-flight, some still queued.
  await pool.close();
  // Every submitted promise must settle (no hang). terminate() fires no events,
  // so the pool itself must resolve in-flight + queued jobs.
  const results = await Promise.all(jobs);
  expect(results.length).toBe(6);
  for (const r of results) expect(typeof r.ok).toBe("boolean");
}, 5000);

test("submit after close resolves ok:false", async () => {
  const pool = new DiffPool(1);
  await pool.close();
  const r = await pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, 0), 0.1);
  expect(r.ok).toBe(false);
}, 5000);
