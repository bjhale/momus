// tests/report/images.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { embedImages, imagesDir, prepareImages } from "../../src/report/images";
import type { ComparisonRecord } from "../../src/types";

function png(w: number, h: number): Uint8Array {
  const p = new PNG({ width: w, height: h });
  p.data.fill(200);
  return new Uint8Array(PNG.sync.write(p));
}

const small = png(4, 4);
const row = (r: Partial<ComparisonRecord> = {}): ComparisonRecord => ({
  path: "/", viewport: 1280, devUrl: "d", prodUrl: "p", status: "ok", passed: true, diffScore: 0,
  devImage: small, prodImage: small, diffImage: small, ...r,
});

async function inTmp(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(import.meta.dir, ".tmp-images-"));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("imagesDir strips the extension and sits beside the report", () => {
  expect(imagesDir("reports/my report.html")).toBe("reports/my report-images");
  expect(imagesDir("out")).toBe("out-images");
});

test("embed writes nothing and returns data URIs", () => inTmp(async (dir) => {
  const out = join(dir, "r.html");
  const src = await prepareImages([row()], "embed", out);
  expect(src(row(), "dev")!.src).toStartWith("data:image/png;base64,");
  expect(src).toBe(embedImages);
  expect(existsSync(imagesDir(out))).toBe(false);
}));

test("link writes each present side and returns relative srcs", () => inTmp(async (dir) => {
  const out = join(dir, "my report.html");
  const rows = [row(), row({ diffImage: undefined })];
  const src = await prepareImages(rows, "link", out);
  expect(readdirSync(imagesDir(out)).sort())
    .toEqual(["0001-dev.png", "0001-diff.png", "0001-prod.png", "0002-dev.png", "0002-prod.png"]);
  expect(src(rows[0]!, "dev")).toEqual({ src: "my%20report-images/0001-dev.png" });
  expect(src(rows[1]!, "diff")).toBeUndefined();
}));

test("thumbnails embeds previews and links originals", () => inTmp(async (dir) => {
  const out = join(dir, "r.html");
  const big = png(1280, 100);
  const rows = [row({ devImage: big })];
  const ref = (await prepareImages(rows, "thumbnails", out))(rows[0]!, "dev")!;
  expect(ref.src).toStartWith("data:image/webp;base64,");
  expect((await new Bun.Image(Buffer.from(ref.src.split(",")[1]!, "base64")).metadata()).width).toBe(400);
  expect(ref.full).toBe("r-images/0001-dev.png");
  expect(readFileSync(join(imagesDir(out), "0001-dev.png")).equals(Buffer.from(big))).toBe(true);
}));

test("thumbnails skips rows without images", () => inTmp(async (dir) => {
  const out = join(dir, "r.html");
  const rows = [row({ status: "error", error: "boom", devImage: undefined, prodImage: undefined, diffImage: undefined })];
  const src = await prepareImages(rows, "thumbnails", out);
  expect(src(rows[0]!, "dev")).toBeUndefined();
  expect(readdirSync(imagesDir(out))).toEqual([]);
}));

test("a re-render removes stale images but keeps other files", () => inTmp(async (dir) => {
  const out = join(dir, "r.html");
  await prepareImages([row(), row()], "link", out);
  writeFileSync(join(imagesDir(out), "notes.txt"), "mine");
  await prepareImages([row()], "link", out);
  expect(readdirSync(imagesDir(out)).sort()).toEqual(["0001-dev.png", "0001-diff.png", "0001-prod.png", "notes.txt"]);
}));

test("an image that won't decode falls back to its link instead of aborting the report", () => inTmp(async (dir) => {
  const out = join(dir, "r.html");
  const rows = [row({ devImage: new Uint8Array([1, 2, 3]), prodImage: new Uint8Array() })];
  const src = await prepareImages(rows, "thumbnails", out);
  expect(src(rows[0]!, "dev")).toEqual({ src: "r-images/0001-dev.png" });
  expect(src(rows[0]!, "prod")).toEqual({ src: "r-images/0001-prod.png" });
  expect(src(rows[0]!, "diff")!.src).toStartWith("data:image/webp;base64,");
}));
