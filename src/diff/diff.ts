// src/diff/diff.ts
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { padToCommon } from "./normalize";
import type { DiffResult } from "../types";

/** Decode two PNG buffers, pad to common size, run pixelmatch, encode diff PNG. */
export function diffPngs(aPng: Uint8Array, bPng: Uint8Array, threshold: number): DiffResult {
  const a = PNG.sync.read(Buffer.from(aPng));
  const b = PNG.sync.read(Buffer.from(bPng));
  const { width, height, aData, bData } = padToCommon(
    { width: a.width, height: a.height, data: new Uint8Array(a.data) },
    { width: b.width, height: b.height, data: new Uint8Array(b.data) },
  );
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(aData, bData, out.data, width, height, {
    threshold, includeAA: false, alpha: 0.3,
  });
  const diffPng = new Uint8Array(PNG.sync.write(out));
  return {
    width, height, diffPixels,
    diffScore: diffPixels / (width * height),
    diffPng,
  };
}
