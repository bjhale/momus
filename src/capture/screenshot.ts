// src/capture/screenshot.ts
import type { Browser, BrowserContext, Page } from "playwright-core";
import { newContext } from "./browser";
import { disableAnimationsCss, maskCss } from "./stabilize";
import type { CaptureResult } from "../types";

export interface StabilizeOptions {
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  settleMs: number;
  timeoutMs: number;
  disableAnimations: boolean;
  mask: string[];
  remove: string[];
}

/** Remove every element matching `selectors` from the DOM before capture, so
 * their layout space collapses (unlike `mask`, which only hides). Searches the
 * document AND every open shadow root (so web-component / portal UI like the
 * Next.js dev indicator, which lives in a shadow root, is reachable —
 * `document.querySelectorAll` alone does not pierce shadow DOM). Invalid
 * selectors are skipped, never aborting the capture. Closed shadow roots are
 * unreachable by any script and are left as-is. */
export async function removeSelectors(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.evaluate((sels) => {
    // Collect the document plus every open shadow root, recursively.
    const roots: (Document | ShadowRoot)[] = [];
    const collect = (root: Document | ShadowRoot) => {
      roots.push(root);
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) collect(el.shadowRoot);
      });
    };
    collect(document);

    for (const sel of sels) {
      for (const root of roots) {
        try {
          root.querySelectorAll(sel).forEach((el) => el.remove());
        } catch {
          /* ignore an invalid selector rather than aborting the capture */
        }
      }
    }
  }, selectors);
}

/** Scroll the page top-to-bottom in steps, pausing so lazy content triggers —
 * IntersectionObserver-based lazy loading only fires when elements enter the
 * viewport, and neither a static load nor a full-page screenshot scrolls — then
 * return to the top. Bounded by `maxMs` so infinite-scroll pages can't hang the
 * capture. `scroll-behavior` is forced to `auto` so a site's smooth-scroll CSS
 * doesn't turn each step into a slow animation. */
export async function autoScroll(page: Page, maxMs: number): Promise<void> {
  await page.evaluate(async (budget) => {
    const doc = document.documentElement;
    const prevBehavior = doc.style.scrollBehavior;
    doc.style.scrollBehavior = "auto";
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const start = Date.now();
    let prevY = -1;
    while (Date.now() - start < budget) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
      await sleep(100);
      const y = window.scrollY;
      if (y === prevY) break; // can't advance further (bottom or stuck)
      prevY = y;
      if (y + window.innerHeight >= doc.scrollHeight) {
        await sleep(150); // let the last viewport's lazy content start loading
        break;
      }
    }
    window.scrollTo(0, 0);
    doc.style.scrollBehavior = prevBehavior;
  }, maxMs);
}

/** Capture a full-page PNG for one url at one viewport width. Never throws;
 * returns { ok:false, error } on failure so one bad page can't abort a run. */
export async function capture(
  browser: Browser,
  url: string,
  viewportWidth: number,
  opts: StabilizeOptions,
  insecure = false,
  requestHeaders?: Record<string, string>,
): Promise<CaptureResult> {
  // Single shared deadline so nav + settle together honor one `timeoutMs` cap
  // (spec §6), rather than allowing up to 2× the configured budget.
  const deadline = Date.now() + opts.timeoutMs;
  // Declared before the try so context/page acquisition happens INSIDE it: if
  // the browser crashed/closed, newContext/newPage reject and we return
  // { ok:false } rather than throwing (upholds "one bad page can't abort a run").
  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, viewportWidth, insecure, requestHeaders);
    const page = await context.newPage();
    // Hard navigation: a genuine load failure (DNS, connection refused, nav
    // timeout) throws here and is recorded as an error (spec §7).
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    // An HTTP error (404/500/…) does NOT throw in Playwright — it returns a
    // response. Treat a non-2xx as a load failure per spec §7. Note: page.goto
    // can also return null (same-document / about:blank / some cached navs);
    // null is treated as success (no HTTP status to reject on).
    if (response && !response.ok()) {
      return { ok: false, error: `HTTP ${response.status()} at ${url}` };
    }
    // Soft settle: if the page loaded but `load`/`networkidle` never settles
    // (long-polling, beacons), capture anyway rather than erroring (spec §7).
    // Use the REMAINING budget; skip if already exhausted (never pass 0 —
    // Playwright treats timeout:0 as "no timeout" / wait forever).
    const remaining = deadline - Date.now();
    if (opts.waitUntil !== "domcontentloaded" && remaining > 0) {
      try {
        await page.waitForLoadState(opts.waitUntil, { timeout: remaining });
      } catch {
        // network never went idle within budget — proceed to capture
      }
    }
    // Trigger below-the-fold lazy loading (IntersectionObserver + native
    // loading="lazy") by scrolling through the page, then let the newly
    // requested resources settle. Bounded by the remaining budget so an
    // infinite-scroll page can't hang the capture.
    let budget = deadline - Date.now();
    if (budget > 0) {
      await autoScroll(page, budget);
      budget = deadline - Date.now();
      if (budget > 0) {
        try {
          await page.waitForLoadState("networkidle", { timeout: budget });
        } catch {
          // scroll-triggered loads didn't fully idle within budget — capture anyway
        }
      }
    }
    // Ensure web fonts are fully loaded and applied before capture.
    // networkidle guarantees font bytes are downloaded; document.fonts.ready
    // guarantees they are parsed and applied to the rendering tree.
    const fontBudget = Math.min(5000, Math.max(0, deadline - Date.now()));
    if (fontBudget > 0) {
      await Promise.race([
        page.evaluate(() => document.fonts.ready),
        page.waitForTimeout(fontBudget),
      ]);
    }

    const css = [
      opts.disableAnimations ? disableAnimationsCss() : "",
      maskCss(opts.mask),
    ].filter(Boolean).join("\n");
    if (css) await page.addStyleTag({ content: css });
    await removeSelectors(page, opts.remove);
    if (opts.settleMs > 0) await page.waitForTimeout(opts.settleMs);
    const png = await page.screenshot({ fullPage: true, type: "png" });
    return { ok: true, png: new Uint8Array(png) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context?.close();
  }
}
