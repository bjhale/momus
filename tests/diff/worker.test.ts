// tests/diff/worker.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";

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

test("worker computes a diff and posts it back", async () => {
  const worker = new Worker(new URL("../../src/diff/worker.ts", import.meta.url).href);
  const a = pngBuffer(8, 8, 255);
  const b = pngBuffer(8, 8, 0);

  const result = await new Promise<any>((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage({ id: 1, aPng: a, bPng: b, threshold: 0.1 });
  });

  expect(result.id).toBe(1);
  expect(result.ok).toBe(true);
  expect(result.diffPixels).toBeGreaterThan(0);
  worker.terminate();
});
