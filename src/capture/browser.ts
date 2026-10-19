// src/capture/browser.ts
// Drive a Playwright engine via `playwright-core`: `launch({ headless: true })`
// resolves the browser from $PLAYWRIGHT_BROWSERS_PATH or the default Playwright
// cache, and `<engine>.executablePath()` returns that path (used for the
// presence check).
import { chromium, firefox, webkit, type BrowserType, type Browser, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";

export type BrowserEngine = "chromium" | "firefox" | "webkit";

/** Which environment captured a baseline (RFC-0006, ADR-0033). */
export type Rendering = "pinned" | "host";

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

/** A logged-in session from setup (RFC-0004), held in memory only. */
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Media features the page's CSS and `matchMedia` see (RFC-0006). */
export interface MediaEmulation {
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark" | "no-preference";
}

export async function newContext(
  browser: Browser, viewportWidth: number, ignoreHTTPSErrors = false, storageState?: StorageState,
  media: MediaEmulation = {},
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors,
    storageState,
    reducedMotion: media.reducedMotion,
    colorScheme: media.colorScheme,
  });
}
