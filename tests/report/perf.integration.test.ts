// tests/report/perf.integration.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { launchBrowser } from "../../src/capture/browser";
import { renderReport } from "../../src/report/template";
import { thumbnail } from "../../src/report/thumbnail";
import type { ImageSource } from "../../src/report/images";
import type { ComparisonRecord } from "../../src/types";
import { launchable, TEST_ENGINES } from "../helpers/engines";

// RFC-0007: a 500-target report in thumbnails mode opens in under 2 s. One
// page-like capture (bands, a hero block, rows of "text") is thumbnailed once
// and shared by every row: what's measured is the browser opening the file.
// Its pseudo-random "text" encodes worse than a real page (~100 KB per preview
// against ~65 KB for a real 1280×5900 capture), so the file size is a worst case.
function pageLike(w: number, h: number): Uint8Array {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const band = Math.floor(y / 300) % 3;
    const text = y % 24 < 4 && (x * 7 + y * 13) % 97 < 70 && x % 300 < 260;
    const hero = y > 120 && y < 520 && x > 160 && x < 1120;
    const c = hero ? [40 + (x % 60), 90, 200] : text ? [50, 50, 50] : [245 - band * 8, 245 - band * 5, 245];
    p.data.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
  }
  return new Uint8Array(PNG.sync.write(p));
}

const thumb = `data:image/webp;base64,${Buffer.from(await thumbnail(pageLike(1280, 3000))).toString("base64")}`;
const rows: ComparisonRecord[] = Array.from({ length: 500 }, (_, i) => ({
  targetId: `/page-${i}`, label: `/page-${i}`, path: `/page-${i}`, viewport: 1280, devUrl: "d", prodUrl: "p",
  status: "ok", passed: i % 5 !== 0, diffScore: (i % 50) / 1000, devImage: new Uint8Array(), prodImage: new Uint8Array(),
  diffImage: new Uint8Array(), width: 1280, height: 3000, devWidth: 1280, devHeight: 3000, prodWidth: 1280, prodHeight: 3000,
}));
const images: ImageSource = (_r, side) => ({ src: thumb, full: `r-images/0001-${side}.png` });

const dir = mkdtempSync(join(import.meta.dir, ".tmp-perf-"));
const file = join(dir, "r.html");
writeFileSync(file, renderReport(rows, { dev: "d", prod: "p" }, undefined, { images }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

for (const engine of TEST_ENGINES) {
  const canLaunch = await launchable(engine);
  describe(engine, () => {
    const maybe = canLaunch ? test : test.skip;
    let browser: Awaited<ReturnType<typeof launchBrowser>>;
    beforeAll(async () => { if (canLaunch) browser = await launchBrowser(engine); });
    afterAll(async () => { await browser?.close(); });

    maybe(`[${engine}] a 500-target thumbnails report opens in under 2 s`, async () => {
      const page = await browser.newPage();
      const t0 = performance.now();
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("main")!.dataset.ready === "1");
      const ms = performance.now() - t0;
      console.log(`[${engine}] ${(statSync(file).size / 1e6).toFixed(1)} MB report opened in ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(2000);
      await page.close();
    });
  });
}
