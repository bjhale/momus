// src/capture/browser.ts
// NOTE (from Chunk 0 spike): import `chromium` from the full `playwright`
// package (NOT playwright-core). It auto-resolves the Chromium it installed, so
// launch() needs no explicit executablePath, and `chromium.executablePath()` is
// a METHOD (there is no top-level `executablePath` export).
import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright-core";
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
