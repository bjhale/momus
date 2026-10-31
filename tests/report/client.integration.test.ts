// tests/report/client.integration.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import type { Page } from "playwright";
import { launchBrowser } from "../../src/capture/browser";
import { renderReport } from "../../src/report/template";
import type { ImageSource } from "../../src/report/images";
import type { ComparisonRecord } from "../../src/types";
import { launchable, TEST_ENGINES } from "../helpers/engines";

function png(rgb: [number, number, number]): Uint8Array {
  const p = new PNG({ width: 40, height: 30 });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([...rgb, 255], i);
  return new Uint8Array(PNG.sync.write(p));
}
const uri = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;
const [red, blue, grey] = [png([200, 0, 0]), png([0, 0, 200]), png([90, 90, 90])];

const compared = (targetId: string, viewport: number, diffScore: number, r: Partial<ComparisonRecord> = {}): ComparisonRecord => ({
  targetId, label: targetId, path: targetId, viewport, devUrl: "d", prodUrl: "p", status: "ok",
  passed: diffScore < 0.01, diffScore, devImage: red, prodImage: blue, diffImage: grey,
  width: 40, height: 30, devWidth: 40, devHeight: 30, prodWidth: 40, prodHeight: 30,
  regions: [{ x: 5, y: 5, width: 10, height: 10 }], regionCount: 1, ...r,
});

// Flat (worst-first): /err, /a@375, /c, /a@1280, /Mixed Case.
// Grouped: /err, /a@375, /a@1280, /c, /Mixed Case.
const ROWS: ComparisonRecord[] = [
  compared("/a", 375, 0.3),
  compared("/a", 1280, 0.25),
  compared("/c", 1280, 0.28),
  compared("/b", 1280, 0.001, { label: "/Mixed Case", source: "scenarios" }),
  { targetId: "/err", label: "/err", path: "/err", viewport: 1280, devUrl: "d", prodUrl: "p", status: "error", error: "boom" },
];

// Thumbnails-shaped: a preview inline, the "original" (here just another
// colour) behind data-full, so the 1:1 swap is observable.
const images: ImageSource = (r, side) => {
  const b = side === "dev" ? r.devImage : side === "prod" ? r.prodImage : r.diffImage;
  return b ? { src: uri(b), full: uri(side === "dev" ? blue : red) } : undefined;
};

const dir = mkdtempSync(join(import.meta.dir, ".tmp-client-"));
const file = join(dir, "report.html");
writeFileSync(file, renderReport(ROWS, { dev: "https://dev", prod: "https://prod" }, undefined, { images }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const visibleLabels = (page: Page) => page.$$eval("main .item:not([hidden])", (els) => els.map((e) => (e as HTMLElement).dataset.label));
const style = (page: Page, sel: string, prop: string) =>
  page.$eval(sel, (el, p) => getComputedStyle(el).getPropertyValue(p as string), prop);
const FIRST = 'main .item[data-label="/a"][data-viewport="375"]';

for (const engine of TEST_ENGINES) {
  const canLaunch = await launchable(engine);
  describe(engine, () => {
    const maybe = canLaunch ? test : test.skip;
    let browser: Awaited<ReturnType<typeof launchBrowser>>;
    beforeAll(async () => { if (canLaunch) browser = await launchBrowser(engine); });
    afterAll(async () => { await browser?.close(); });

    async function open(): Promise<Page> {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => document.querySelector("main")!.dataset.ready === "1");
      return page;
    }

    maybe(`[${engine}] slider clips prod at the range position`, async () => {
      const page = await open();
      await page.click(`${FIRST} > summary`);
      await page.click(`${FIRST} [data-mode="slider"]`);
      await page.fill(`${FIRST} .mix`, "30");
      expect(await style(page, `${FIRST} [data-side="prod"]`, "clip-path")).toContain("30%");
      expect(await style(page, `${FIRST} [data-side="diff"]`, "display")).toBe("none");
      expect(await page.$eval("main", (m) => m.dataset.mode)).toBe("slider");
      // The mode is global: another item's toolbar shows it too.
      expect(await page.getAttribute('main .item[data-label="/c"] [data-mode="slider"]', "aria-pressed")).toBe("true");
      await page.close();
    });

    maybe(`[${engine}] onion skin fades prod`, async () => {
      const page = await open();
      await page.click(`${FIRST} > summary`);
      await page.click(`${FIRST} [data-mode="onion"]`);
      await page.fill(`${FIRST} .mix`, "25");
      expect(Number(await style(page, `${FIRST} [data-side="prod"]`, "opacity"))).toBeCloseTo(0.25, 5);
      await page.close();
    });

    maybe(`[${engine}] highlight shows dev alone`, async () => {
      const page = await open();
      await page.click(`${FIRST} > summary`);
      await page.keyboard.press("4");
      expect(await style(page, `${FIRST} [data-side="dev"]`, "display")).not.toBe("none");
      expect(await style(page, `${FIRST} [data-side="prod"]`, "display")).toBe("none");
      expect(await style(page, `${FIRST} [data-side="diff"]`, "display")).toBe("none");
      await page.close();
    });

    maybe(`[${engine}] 1:1 swaps in the originals and lets the stage scroll`, async () => {
      const page = await open();
      await page.focus(`${FIRST} > summary`);
      await page.keyboard.press("Enter");
      const full = await page.getAttribute(`${FIRST} [data-side="dev"] img`, "data-full");
      await page.keyboard.press("z");
      expect(await page.getAttribute(`${FIRST} [data-side="dev"] img`, "src")).toBe(full!);
      expect(await style(page, `${FIRST} .stage`, "overflow-y")).toBe("auto");
      expect(await page.getAttribute(`${FIRST} [data-action="zoom"]`, "aria-pressed")).toBe("true");
      await page.close();
    });

    maybe(`[${engine}] j/k walk the visible items without a mouse`, async () => {
      const page = await open();
      await page.focus('nav [data-status="pass"]');
      await page.keyboard.press("Space");
      expect(await visibleLabels(page)).toEqual(["/err", "/a", "/c", "/a"]);
      await page.keyboard.press("j");
      await page.keyboard.press("j");
      const state = await page.$$eval("main .item", (els) => els.map((e) => (e as HTMLDetailsElement).open));
      expect(state).toEqual([false, true, false, false, false]);
      expect(await page.evaluate(() => document.activeElement!.closest(".item")!.getAttribute("data-viewport"))).toBe("375");
      await page.keyboard.press("k");
      expect(await page.evaluate(() => document.activeElement!.closest(".item")!.getAttribute("data-label"))).toBe("/err");
      await page.close();
    });

    maybe(`[${engine}] search filters case-insensitively and swallows shortcuts`, async () => {
      const page = await open();
      await page.keyboard.press("/");
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).dataset.filter)).toBe("path");
      await page.keyboard.type("j1");
      expect(await page.$eval("main", (m) => m.dataset.mode)).toBe("side");
      expect(await page.$$eval("main .item[open]", (els) => els.length)).toBe(0);
      expect(await page.inputValue('[data-filter="path"]')).toBe("j1");
      await page.fill('[data-filter="path"]', "");
      await page.keyboard.type("MIXED");
      expect(await visibleLabels(page)).toEqual(["/Mixed Case"]);
      expect(await page.textContent(".shown")).toBe("1 of 5 shown");
      await page.close();
    });

    maybe(`[${engine}] status, source and viewport filters combine`, async () => {
      const page = await open();
      await page.selectOption('[data-filter="source"]', "pages");
      await page.selectOption('[data-filter="viewport"]', "1280");
      expect(await visibleLabels(page)).toEqual(["/err", "/c", "/a"]);
      await page.click('nav [data-status="fail"]');
      expect(await visibleLabels(page)).toEqual(["/err"]);
      await page.close();
    });

    maybe(`[${engine}] grouping puts a target's viewports together and restores the order`, async () => {
      const page = await open();
      await page.keyboard.press("g");
      expect(await visibleLabels(page)).toEqual(["/err", "/a", "/a", "/c", "/Mixed Case"]);
      expect(await page.$$eval(".group-head", (els) => els.map((e) => e.textContent))).toEqual(["/err", "/a", "/c", "/Mixed Case"]);
      await page.click('nav [data-status="error"]');
      expect(await page.$$eval(".group-head:not([hidden])", (els) => els.length)).toBe(3);
      await page.keyboard.press("g");
      await page.click('nav [data-status="error"]');
      expect(await visibleLabels(page)).toEqual(["/err", "/a", "/c", "/a", "/Mixed Case"]);
      expect(await page.$$eval(".group-head", (els) => els.length)).toBe(0);
      await page.close();
    });
  });
}
