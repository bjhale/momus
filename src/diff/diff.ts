// src/diff/diff.ts
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { padToCommon } from "./normalize";
import { changeRegions } from "./regions";
import type { DiffResult } from "../types";

export interface DiffOptions {
  /** pixelmatch's per-pixel color tolerance, 0..1 (ADR-0004). */
  threshold: number;
  /** Count anti-aliased pixels as changes. false = AA detection on (RFC-0006). */
  includeAA: boolean;
}

/** Where only one side has pixels, painted over the diff image so a size
 * change reads apart from content changes (pixelmatch draws those red). */
export const PAD_COLOR = [255, 0, 255] as const;
const DIFF_COLOR: [number, number, number] = [255, 0, 0];

/** Decode two PNG buffers, pad to common size, run pixelmatch, encode diff PNG. */
export function diffPngs(aPng: Uint8Array, bPng: Uint8Array, opts: DiffOptions): DiffResult {
  const a = PNG.sync.read(Buffer.from(aPng));
  const b = PNG.sync.read(Buffer.from(bPng));
  const { width, height, aData, bData } = padToCommon(
    { width: a.width, height: a.height, data: new Uint8Array(a.data) },
    { width: b.width, height: b.height, data: new Uint8Array(b.data) },
  );
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(aData, bData, out.data, width, height, {
    threshold: opts.threshold, includeAA: opts.includeAA, alpha: 0.3,
    diffColor: DIFF_COLOR, aaColor: [255, 255, 0],
  });

  // Content changes are clustered within the area both sides cover: drawn in
  // the diff color (pure red never occurs in pixelmatch's grayscale
  // background). The pad band is added as up to two strips of its own, right
  // and bottom: clustered with the rest, an L-shaped band's box is the whole
  // frame, and a change beside it would merge into it. The band counts as a
  // region: on a pure size change it is the change.
  const minW = Math.min(a.width, b.width), minH = Math.min(a.height, b.height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, i = p * 4;
      if (x >= minW || y >= minH) {
        out.data[i] = PAD_COLOR[0]; out.data[i + 1] = PAD_COLOR[1]; out.data[i + 2] = PAD_COLOR[2]; out.data[i + 3] = 255;
      } else if (out.data[i] === 255 && out.data[i + 1] === 0 && out.data[i + 2] === 0) {
        mask[p] = 1;
      }
    }
  }
  const content = changeRegions(mask, width, height);
  const strips = [
    ...(width > minW ? [{ x: minW, y: 0, width: width - minW, height }] : []),
    ...(height > minH ? [{ x: 0, y: minH, width: minW, height: height - minH }] : []),
  ];
  const regions = [...strips, ...content.regions].sort((p, q) => q.width * q.height - p.width * p.height).slice(0, 100);
  const count = content.count + strips.length;

  const diffPng = new Uint8Array(PNG.sync.write(out));
  return {
    width, height, diffPixels,
    diffScore: diffPixels / (width * height),
    diffPng,
    aWidth: a.width, aHeight: a.height, bWidth: b.width, bHeight: b.height,
    regions, regionCount: count,
  };
}
