// src/capture/screenshot.ts
import type { Browser, BrowserContext } from "playwright-core";
import { newContext } from "./browser";
import { disableAnimationsCss, maskCss } from "./stabilize";
import type { CaptureResult } from "../types";

export interface StabilizeOptions {
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  settleMs: number;
  timeoutMs: number;
  disableAnimations: boolean;
  mask: string[];
}

/** Capture a full-page PNG for one url at one viewport width. Never throws;
 * returns { ok:false, error } on failure so one bad page can't abort a run. */
export async function capture(
  browser: Browser,
  url: string,
  viewportWidth: number,
  opts: StabilizeOptions,
  insecure = false,
): Promise<CaptureResult> {
  // Single shared deadline so nav + settle together honor one `timeoutMs` cap
  // (spec §6), rather than allowing up to 2× the configured budget.
  const deadline = Date.now() + opts.timeoutMs;
  // Declared before the try so context/page acquisition happens INSIDE it: if
  // the browser crashed/closed, newContext/newPage reject and we return
  // { ok:false } rather than throwing (upholds "one bad page can't abort a run").
  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, viewportWidth, insecure);
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
    const css = [
      opts.disableAnimations ? disableAnimationsCss() : "",
      maskCss(opts.mask),
    ].filter(Boolean).join("\n");
    if (css) await page.addStyleTag({ content: css });
    if (opts.settleMs > 0) await page.waitForTimeout(opts.settleMs);
    const png = await page.screenshot({ fullPage: true, type: "png" });
    return { ok: true, png: new Uint8Array(png) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context?.close();
  }
}
