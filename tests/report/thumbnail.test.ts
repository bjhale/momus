// tests/report/thumbnail.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { thumbnail } from "../../src/report/thumbnail";

function png(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(fill(x, y), (y * w + x) * 4);
  return new Uint8Array(PNG.sync.write(p));
}
const decode = (b: Uint8Array) => PNG.sync.read(Buffer.from(b));

test("thumbnail keeps an image no wider than maxWidth as-is", () => {
  const src = png(300, 50, () => [1, 2, 3, 255]);
  expect(thumbnail(src)).toBe(src);
});

test("thumbnail scales to maxWidth, keeping the aspect ratio", () => {
  const out = decode(thumbnail(png(1280, 3000, (x, y) => [x % 256, y % 256, 0, 255])));
  expect([out.width, out.height]).toEqual([400, 938]);
});

test("thumbnail averages, so a black and white pair becomes mid-grey", () => {
  const out = decode(thumbnail(png(2, 1, (x) => x ? [255, 255, 255, 255] : [0, 0, 0, 255]), 1));
  expect([out.width, out.height]).toEqual([1, 1]);
  expect(out.data[0]).toBeGreaterThanOrEqual(127);
  expect(out.data[0]).toBeLessThanOrEqual(128);
  expect(out.data[3]).toBe(255);
});

test("thumbnail height never rounds to 0", () => {
  const out = decode(thumbnail(png(1000, 1, () => [0, 0, 0, 255])));
  expect([out.width, out.height]).toEqual([400, 1]);
});
