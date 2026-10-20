// src/report/images.ts
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ComparisonRecord } from "../types";
import { thumbnail } from "./thumbnail";

/** How the report carries its images (RFC-0007): inline, as files beside it,
 * or inline previews with the files linked. */
export type ReportImages = "embed" | "link" | "thumbnails";
export type ImageSide = "dev" | "prod" | "diff";
/** `full` is the original, linked, when `src` is only a preview. */
export interface ImageRef { src: string; full?: string }
export type ImageSource = (r: ComparisonRecord, side: ImageSide) => ImageRef | undefined;

const SIDES: ImageSide[] = ["dev", "prod", "diff"];
const bytes = (r: ComparisonRecord, side: ImageSide) =>
  side === "dev" ? r.devImage : side === "prod" ? r.prodImage : r.diffImage;
const dataUri = (b: Uint8Array, type = "png") => `data:image/${type};base64,${Buffer.from(b).toString("base64")}`;

export const embedImages: ImageSource = (r, side) => {
  const b = bytes(r, side);
  return b ? { src: dataUri(b) } : undefined;
};

/** `reports/momus-report.html` → `reports/momus-report-images`. */
export function imagesDir(outPath: string): string {
  return join(dirname(outPath), basename(outPath, extname(outPath)) + "-images");
}

// Only names this module writes, so a re-render never deletes a user's file.
const OURS = /^\d{4,}-(dev|prod|diff)\.png$/;

/** Write whatever files the mode needs and return where each image is. All
 * the report's file I/O lives here, so renderReport stays pure. */
export async function prepareImages(records: ComparisonRecord[], mode: ReportImages, outPath: string): Promise<ImageSource> {
  if (mode === "embed") return embedImages;
  const dir = imagesDir(outPath);
  mkdirSync(dir, { recursive: true });
  // A smaller run rendered into the same directory would otherwise leave the
  // previous render's images behind.
  for (const f of readdirSync(dir)) if (OURS.test(f)) rmSync(join(dir, f));
  const rel = encodeURIComponent(basename(dir));
  const refs = new Map<ComparisonRecord, Partial<Record<ImageSide, ImageRef>>>();
  for (const [i, r] of records.entries()) {
    const entry: Partial<Record<ImageSide, ImageRef>> = {};
    // A row's three sides at once: thumbnails encode on Bun.Image's worker thread.
    await Promise.all(SIDES.map(async (side) => {
      const b = bytes(r, side);
      if (!b) return;
      const file = `${String(i + 1).padStart(4, "0")}-${side}.png`;
      await Bun.write(join(dir, file), b);
      const linked = `${rel}/${file}`;
      if (mode === "link") { entry[side] = { src: linked }; return; }
      // One image that won't decode must not cost the whole report (ADR-0006):
      // that side shows the linked original, as in link mode.
      try {
        entry[side] = { src: dataUri(await thumbnail(b), "webp"), full: linked };
      } catch {
        entry[side] = { src: linked };
      }
    }));
    refs.set(r, entry);
  }
  return (r, side) => refs.get(r)?.[side];
}
