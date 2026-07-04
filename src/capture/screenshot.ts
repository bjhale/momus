// src/capture/screenshot.ts
import type { Browser } from "playwright-core";
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
): Promise<CaptureResult> {
  const context = await newContext(browser, viewportWidth);
  const page = await context.newPage();
  // Single shared deadline so nav + settle together honor one `timeoutMs` cap
  // (spec §6), rather than allowing up to 2× the configured budget.
  const deadline = Date.now() + opts.timeoutMs;
  try {
    // Hard navigation: a genuine load failure (DNS, connection refused, nav
    // timeout) throws here and is recorded as an error (spec §7).
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    // An HTTP error (404/500/…) does NOT throw in Playwright — it returns a
    // response. Treat a non-2xx as a load failure per spec §7.
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
    await context.close();
  }
}
