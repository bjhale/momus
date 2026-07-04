// tests/diff/diff.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { diffPngs } from "../../src/diff/diff";

function pngBuffer(w: number, h: number, rgba: [number, number, number, number]): Uint8Array {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return new Uint8Array(PNG.sync.write(png));
}

test("identical images have zero diff", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 10, [255, 0, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.diffPixels).toBe(0);
  expect(r.diffScore).toBe(0);
});

test("fully different images have high score", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 10, [0, 255, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.diffPixels).toBe(100);
  expect(r.diffScore).toBeCloseTo(1, 5);
});

test("different-sized images are padded and diffed", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 20, [255, 0, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.width).toBe(10);
  expect(r.height).toBe(20);
  // The extra 10 rows differ (opaque red vs opaque magenta padding).
  expect(r.diffPixels).toBeGreaterThan(0);
});

test("a white page that grew taller produces a non-zero diff", () => {
  // Regression (spec §7): with transparent padding, pixelmatch blends the
  // padded region toward its white background, so a full-page height change on
  // a WHITE page reads as identical (0 diff). The opaque magenta sentinel must
  // make the added 10 rows show up as a diff.
  const shortWhite = pngBuffer(10, 10, [255, 255, 255, 255]);
  const tallWhite = pngBuffer(10, 20, [255, 255, 255, 255]);
  const r = diffPngs(shortWhite, tallWhite, 0.1);
  expect(r.width).toBe(10);
  expect(r.height).toBe(20);
  expect(r.diffPixels).toBeGreaterThan(0);
});
