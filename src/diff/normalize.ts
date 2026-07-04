// src/diff/normalize.ts

export interface RawImage { width: number; height: number; data: Uint8Array }

/** Pad two RGBA images to their common max dimensions. Never scales (spec §5).
 * Padded regions are an OPAQUE magenta sentinel (255,0,255,255), not
 * transparent — see padImage for why. */
export function padToCommon(a: RawImage, b: RawImage): {
  width: number; height: number; aData: Uint8Array; bData: Uint8Array;
} {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  return {
    width, height,
    aData: padImage(a, width, height),
    bData: padImage(b, width, height),
  };
}

function padImage(img: RawImage, width: number, height: number): Uint8Array {
  if (img.width === width && img.height === height) return img.data;
  const out = new Uint8Array(width * height * 4);
  // Fill padding with an OPAQUE magenta sentinel BEFORE copying real rows on top.
  // A zero-filled (transparent) pad blends toward pixelmatch's white background,
  // so a size change on a white/light page would read as identical and silently
  // hide the regression (spec §7). Magenta can't be confused with real content.
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255; out[i + 1] = 0; out[i + 2] = 255; out[i + 3] = 255;
  }
  for (let y = 0; y < img.height; y++) {
    const srcStart = y * img.width * 4;
    const dstStart = y * width * 4;
    out.set(img.data.subarray(srcStart, srcStart + img.width * 4), dstStart);
  }
  return out;
}
