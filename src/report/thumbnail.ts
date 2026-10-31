// src/report/thumbnail.ts

/** Wide enough for a triptych column on a laptop screen; the 1:1 view links
 * the original for anything finer (RFC-0007). */
export const THUMB_WIDTH = 400;
const THUMB_QUALITY = 60;

/** A downscaled WebP preview for the report. WebP, not PNG: downscaled text
 * is all antialiased edges, which PNG barely compresses (a 400 px preview of a
 * full page came out at ~45% of the original's bytes; WebP ~8%). Display only:
 * diffs are always computed on the full-size captures (ADR-0003), and a
 * thumbnail never reaches the DB. */
export async function thumbnail(png: Uint8Array, maxWidth = THUMB_WIDTH): Promise<Uint8Array> {
  return new Bun.Image(png)
    .resize(maxWidth, undefined, { withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .bytes();
}
