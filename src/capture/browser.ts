// src/capture/browser.ts
// Drive a Playwright engine via `playwright-core`: `launch({ headless: true })`
// resolves the browser from $PLAYWRIGHT_BROWSERS_PATH or the default Playwright
// cache, and `<engine>.executablePath()` returns that path (used for the
// presence check).
import { chromium, firefox, webkit, type BrowserType, type Browser, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";

export type BrowserEngine = "chromium" | "firefox" | "webkit";

/** Exported so tests can spy on a specific engine's launch/executablePath. */
export const ENGINES: Record<BrowserEngine, BrowserType> = { chromium, firefox, webkit };

/** True if the pinned executable for the given engine exists on disk. */
export function isBrowserInstalled(engine: BrowserEngine = "chromium"): boolean {
  try {
    const p = ENGINES[engine].executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}

export async function launchBrowser(engine: BrowserEngine = "chromium"): Promise<Browser> {
  return ENGINES[engine].launch({ headless: true });
}

export async function newContext(
  browser: Browser, viewportWidth: number, ignoreHTTPSErrors = false,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors,
  });
}
