// tests/report/thumbnail.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { thumbnail } from "../../src/report/thumbnail";

function png(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(fill(x, y), (y * w + x) * 4);
  return new Uint8Array(PNG.sync.write(p));
}
const meta = (b: Uint8Array) => new Bun.Image(b).metadata();

test("thumbnail scales to maxWidth as WebP, keeping the aspect ratio", async () => {
  const out = await thumbnail(png(1280, 3000, (x, y) => [x % 256, y % 256, 0, 255]));
  const m = await meta(out);
  expect([m.width, m.format]).toEqual([400, "webp"]);
  expect(Math.abs(m.height - 3000 * 400 / 1280)).toBeLessThanOrEqual(1); // 937.5, either way
});

test("thumbnail never enlarges, but still re-encodes", async () => {
  expect(await meta(await thumbnail(png(300, 50, () => [1, 2, 3, 255])))).toEqual({ width: 300, height: 50, format: "webp" });
});

test("thumbnail height never rounds to 0", async () => {
  const m = await meta(await thumbnail(png(1000, 1, () => [0, 0, 0, 255])));
  expect([m.width, m.height]).toEqual([400, 1]);
});

test("thumbnail is much smaller than the capture it previews", async () => {
  // Antialiased-text-like content: what made PNG previews barely smaller.
  const src = png(1280, 2000, (x, y) => {
    const v = y % 18 < 12 && x % 9 < 6 ? 40 + ((x * 31 + y * 17) % 160) : 250;
    return [v, v, v, 255];
  });
  expect((await thumbnail(src)).length).toBeLessThan(src.length / 4);
});
