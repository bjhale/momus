// src/diff/normalize.ts

export interface RawImage { width: number; height: number; data: Uint8Array }

/** Pad two RGBA images with transparent pixels to their common max dimensions.
 * Never scales (spec §5). Padded regions are transparent (0,0,0,0). */
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
  const out = new Uint8Array(width * height * 4); // zero-filled = transparent
  for (let y = 0; y < img.height; y++) {
    const srcStart = y * img.width * 4;
    const dstStart = y * width * 4;
    out.set(img.data.subarray(srcStart, srcStart + img.width * 4), dstStart);
  }
  return out;
}
