// src/capture/browser.ts
// Drive Chromium via `playwright-core`: `launch({ headless: true })` resolves the
// browser from $PLAYWRIGHT_BROWSERS_PATH or the default Playwright cache, and
// `chromium.executablePath()` returns that path (used for the presence check).
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";

/** True if the pinned Chromium executable exists on disk. */
export function isBrowserInstalled(): boolean {
  try {
    const p = chromium.executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function newContext(browser: Browser, viewportWidth: number): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
  });
}
