// tests/diff/normalize.test.ts
import { test, expect } from "bun:test";
import { padToCommon } from "../../src/diff/normalize";

function solid(w: number, h: number, val: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(w * h * 4).fill(val);
  return { width: w, height: h, data };
}

test("pads both images to max width and height", () => {
  const a = solid(2, 2, 255);
  const b = solid(4, 3, 128);
  const { width, height, aData, bData } = padToCommon(a, b);
  expect(width).toBe(4);
  expect(height).toBe(3);
  expect(aData.length).toBe(4 * 3 * 4);
  expect(bData.length).toBe(4 * 3 * 4);
});

test("identical dimensions pass through unchanged", () => {
  const a = solid(2, 2, 255);
  const b = solid(2, 2, 0);
  const { width, height, aData, bData } = padToCommon(a, b);
  expect(width).toBe(2);
  expect(height).toBe(2);
  expect(aData[0]).toBe(255);
  expect(bData[0]).toBe(0);
});
