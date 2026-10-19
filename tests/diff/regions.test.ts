// tests/diff/regions.test.ts
import { test, expect } from "bun:test";
import { changeRegions } from "../../src/diff/regions";

function mask(w: number, h: number, on: Array<[number, number]>): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const [x, y] of on) m[y * w + x] = 1;
  return m;
}
/** Every pixel of the rectangle [x, x+w) × [y, y+h). */
function rect(x: number, y: number, w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push([i, j]);
  return out;
}

test("an empty mask has no regions", () => {
  expect(changeRegions(new Uint8Array(100 * 100), 100, 100)).toEqual({ regions: [], count: 0 });
});

test("a single pixel is a 1×1 region at that pixel", () => {
  expect(changeRegions(mask(100, 100, [[5, 7]]), 100, 100)).toEqual({ regions: [{ x: 5, y: 7, width: 1, height: 1 }], count: 1 });
});

test("two blobs far apart are two regions, each tight to its pixels", () => {
  const r = changeRegions(mask(200, 50, [...rect(3, 4, 5, 6), ...rect(120, 10, 2, 3)]), 200, 50);
  expect(r.count).toBe(2);
  expect(r.regions).toEqual([{ x: 3, y: 4, width: 5, height: 6 }, { x: 120, y: 10, width: 2, height: 3 }]);
});

test("blobs in adjacent cells merge into one region", () => {
  // x 10..12 is in cell 0, x 22..24 in cell 1: neighbors.
  const r = changeRegions(mask(100, 50, [...rect(10, 5, 3, 3), ...rect(22, 5, 3, 3)]), 100, 50);
  expect(r).toEqual({ regions: [{ x: 10, y: 5, width: 15, height: 3 }], count: 1 });
});

test("diagonal neighbors merge (8-connectivity)", () => {
  const r = changeRegions(mask(100, 100, [[15, 15], [16, 16]]), 100, 100);
  expect(r.count).toBe(1);
});

test("regions are capped at max, largest first, and count is the true total", () => {
  const w = 150 * 32, on: Array<[number, number]> = [];
  // 150 blobs, one per other cell; blob i is (i % 5 + 1) px wide.
  for (let i = 0; i < 150; i++) on.push(...rect(i * 32, 0, (i % 5) + 1, 1));
  const r = changeRegions(mask(w, 1, on), w, 1);
  expect(r.count).toBe(150);
  expect(r.regions.length).toBe(100);
  const areas = r.regions.map((g) => g.width * g.height);
  expect(areas).toEqual([...areas].sort((a, b) => b - a));
  expect(areas[0]).toBe(5);
});
