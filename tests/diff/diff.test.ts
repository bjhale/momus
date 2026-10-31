// tests/diff/diff.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { diffPngs, PAD_COLOR } from "../../src/diff/diff";

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
  const r = diffPngs(a, b, { threshold: 0.1, includeAA: false });
  expect(r.diffPixels).toBe(0);
  expect(r.diffScore).toBe(0);
});

test("fully different images have high score", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 10, [0, 255, 0, 255]);
  const r = diffPngs(a, b, { threshold: 0.1, includeAA: false });
  expect(r.diffPixels).toBe(100);
  expect(r.diffScore).toBeCloseTo(1, 5);
});

test("different-sized images are padded and diffed", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 20, [255, 0, 0, 255]);
  const r = diffPngs(a, b, { threshold: 0.1, includeAA: false });
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
  const r = diffPngs(shortWhite, tallWhite, { threshold: 0.1, includeAA: false });
  expect(r.width).toBe(10);
  expect(r.height).toBe(20);
  expect(r.diffPixels).toBeGreaterThan(0);
});

const OPTS = { threshold: 0.1, includeAA: false };
const px = (png: Uint8Array, x: number, y: number) => {
  const img = PNG.sync.read(Buffer.from(png));
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

test("identical images report their sizes and no regions", () => {
  const r = diffPngs(pngBuffer(10, 10, [9, 9, 9, 255]), pngBuffer(10, 10, [9, 9, 9, 255]), OPTS);
  expect([r.aWidth, r.aHeight, r.bWidth, r.bHeight]).toEqual([10, 10, 10, 10]);
  expect(r.regionCount).toBe(0);
  expect(r.regions).toEqual([]);
});

test("a size change reports each side's size, paints the band PAD_COLOR, and is a region", () => {
  const r = diffPngs(pngBuffer(10, 10, [200, 200, 200, 255]), pngBuffer(10, 14, [200, 200, 200, 255]), OPTS);
  expect([r.aWidth, r.aHeight, r.bWidth, r.bHeight]).toEqual([10, 10, 10, 14]);
  expect(r.diffPixels).toBe(40);
  expect(px(r.diffPng, 3, 12)).toEqual([...PAD_COLOR]);
  expect(px(r.diffPng, 3, 5)).not.toEqual([...PAD_COLOR]);
  expect(r.regions).toEqual([{ x: 0, y: 10, width: 10, height: 4 }]);
});

test("a one-pixel change is a 1×1 region, drawn red", () => {
  const a = PNG.sync.read(Buffer.from(pngBuffer(20, 20, [255, 255, 255, 255])));
  a.data.set([0, 0, 0, 255], (7 * 20 + 4) * 4);
  const r = diffPngs(new Uint8Array(PNG.sync.write(a)), pngBuffer(20, 20, [255, 255, 255, 255]), OPTS);
  expect(r.regions).toEqual([{ x: 4, y: 7, width: 1, height: 1 }]);
  expect(px(r.diffPng, 4, 7)).toEqual([255, 0, 0]);
});

test("includeAA: true counts anti-aliased pixels that detection would skip", () => {
  // A soft-edged dark square shifted by one pixel: its gray edge pixels read as anti-aliasing.
  const draw = (dx: number) => {
    const p = new PNG({ width: 30, height: 30 });
    p.data.fill(255);
    for (let y = 8; y < 22; y++) for (let x = 8 + dx; x < 22 + dx; x++) {
      const edge = y === 8 || y === 21 || x === 8 + dx || x === 21 + dx;
      const v = edge ? 128 : 0;
      p.data.set([v, v, v, 255], (y * 30 + x) * 4);
    }
    return new Uint8Array(PNG.sync.write(p));
  };
  const off = diffPngs(draw(0), draw(1), { threshold: 0.1, includeAA: false });
  const on = diffPngs(draw(0), draw(1), { threshold: 0.1, includeAA: true });
  expect(on.diffPixels).toBeGreaterThan(off.diffPixels);
});

test("when width and height both differ, each pad strip is its own region", () => {
  const r = diffPngs(pngBuffer(100, 200, [200, 200, 200, 255]), pngBuffer(120, 150, [200, 200, 200, 255]), OPTS);
  expect(r.regionCount).toBe(2);
  expect(r.regions).toContainEqual({ x: 100, y: 0, width: 20, height: 200 });
  expect(r.regions).toContainEqual({ x: 0, y: 150, width: 100, height: 50 });
});

test("a content change beside the pad band stays its own region", () => {
  const a = PNG.sync.read(Buffer.from(pngBuffer(20, 20, [255, 255, 255, 255])));
  a.data.set([0, 0, 0, 255], (18 * 20 + 5) * 4);
  const r = diffPngs(new Uint8Array(PNG.sync.write(a)), pngBuffer(20, 40, [255, 255, 255, 255]), OPTS);
  expect(r.regionCount).toBe(2);
  expect(r.regions).toContainEqual({ x: 5, y: 18, width: 1, height: 1 });
  expect(r.regions).toContainEqual({ x: 0, y: 20, width: 20, height: 20 });
});
