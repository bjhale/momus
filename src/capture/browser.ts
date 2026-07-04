// src/capture/browser.ts
// Import `chromium` from `playwright-core`, NOT the full `playwright` package.
// The full wrapper does a runtime `require('playwright-core/package.json')` that
// `bun build --compile` cannot bundle, which makes the standalone binary fail.
// playwright-core is fully bundleable: `launch({headless:true})` auto-resolves
// the browser (from $PLAYWRIGHT_BROWSERS_PATH or the default cache) and
// `chromium.executablePath()` works — both verified from a compiled binary with
// no node_modules present.
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
