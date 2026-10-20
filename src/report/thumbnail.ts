// src/report/thumbnail.ts
import { PNG } from "pngjs";

/** Wide enough for a triptych column on a laptop screen; the 1:1 view links
 * the original for anything finer (RFC-0007). */
export const THUMB_WIDTH = 400;

/** A downscaled preview for the report, by area averaging. Display only:
 * diffs are always computed on the full-size captures (ADR-0003), and a
 * thumbnail never reaches the DB. */
export function thumbnail(png: Uint8Array, maxWidth = THUMB_WIDTH): Uint8Array {
  const src = PNG.sync.read(Buffer.from(png));
  if (src.width <= maxWidth) return png;
  const w = maxWidth;
  const h = Math.max(1, Math.round((src.height * w) / src.width));
  const sx = src.width / w, sy = src.height / h;
  const out = new PNG({ width: w, height: h });
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor(ty * sy), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor(tx * sx), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; a += src.data[i + 3]!;
        }
      }
      const n = (x1 - x0) * (y1 - y0), o = (ty * w + tx) * 4;
      out.data[o] = Math.round(r / n); out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n); out.data[o + 3] = Math.round(a / n);
    }
  }
  return new Uint8Array(PNG.sync.write(out));
}
