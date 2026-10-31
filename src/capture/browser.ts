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

/** The Docker image sets MOMUS_RENDERING=pinned; anywhere else is "host". An
 * unknown value is refused rather than read as host, since a typo would
 * otherwise turn a pinned baseline into a conflict nobody can explain. */
export function renderingMode(env: Record<string, string | undefined> = process.env): Rendering {
  const v = env.MOMUS_RENDERING;
  if (v === undefined || v === "" || v === "host") return "host";
  if (v === "pinned") return "pinned";
  throw new Error(`MOMUS_RENDERING must be "pinned" or "host", got "${v}"`);
}

/** Chromium's host-dependent rendering, switched off in the reference
 * environment: GPU compositing, font hinting, subpixel text positioning, LCD
 * text, and the display's color profile. Firefox and WebKit get no flags; for
 * them "pinned" means the image's fixed fonts and libraries. The gate compares
 * only "pinned", so these can change without invalidating baselines. */
export const PINNED_CHROMIUM_ARGS = [
  "--disable-gpu",
  "--font-render-hinting=none",
  "--disable-font-subpixel-positioning",
  "--disable-lcd-text",
  "--force-color-profile=srgb",
];

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

export async function launchBrowser(engine: BrowserEngine = "chromium", rendering: Rendering = "host"): Promise<Browser> {
  return ENGINES[engine].launch(rendering === "pinned" && engine === "chromium"
    ? { headless: true, args: PINNED_CHROMIUM_ARGS }
    : { headless: true });
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
