// tests/diff/pool.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { DiffPool } from "../../src/diff/pool";
import { diffPngs } from "../../src/diff/diff";

// Opaque (alpha=255) so diffs are genuine — a transparent fill blends to the
// background and reads as identical under pixelmatch.
function pngBuffer(w: number, h: number, v: number): Uint8Array {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
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

test("falls back to inline diffing when workers cannot load, producing correct diffs", async () => {
  // A bad worker URL makes every worker fail to load -> onerror -> inline mode.
  const pool = new DiffPool(2, new URL("./does-not-exist.ts", import.meta.url).href);
  const inputs = Array.from({ length: 4 }, (_, i) =>
    [pngBuffer(8, 8, 255), pngBuffer(8, 8, i * 20)] as const);
  const results = await Promise.all(inputs.map(([a, b]) => pool.submit(a, b, 0.1)));
  expect(results.length).toBe(4);
  for (let i = 0; i < inputs.length; i++) {
    const [a, b] = inputs[i]!;
    const expected = diffPngs(a, b, 0.1);
    expect(results[i]!.ok).toBe(true);
    // Inline path must produce the exact same diff as calling diffPngs directly.
    expect(results[i]!.diffPixels).toBe(expected.diffPixels);
    expect(results[i]!.width).toBe(expected.width);
    expect(results[i]!.height).toBe(expected.height);
  }
  await pool.close();
}, 5000);

test("submit after inline fallback still returns a correct diff", async () => {
  const pool = new DiffPool(1, new URL("./does-not-exist.ts", import.meta.url).href);
  // First submit triggers the fallback.
  await pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, 0), 0.1);
  // Subsequent submit goes straight to inline and must still be correct.
  const a = pngBuffer(8, 8, 255), b = pngBuffer(8, 8, 128);
  const r = await pool.submit(a, b, 0.1);
  const expected = diffPngs(a, b, 0.1);
  expect(r.ok).toBe(true);
  expect(r.diffPixels).toBe(expected.diffPixels);
  await pool.close();
}, 5000);
