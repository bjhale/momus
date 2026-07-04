// spike/screenshot-spike.ts
// The full `playwright` package auto-resolves the Chromium it installed, so
// chromium.launch() needs no explicit executablePath. chromium.executablePath()
// exposes the resolved path (used later by isBrowserInstalled).
import { chromium } from "playwright";

console.log(`resolved chromium at: ${chromium.executablePath()}`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("https://example.com", { waitUntil: "networkidle" });
const buf = await page.screenshot({ fullPage: true });
await browser.close();
console.log(`captured ${buf.length} bytes`);
if (buf.length < 1000) throw new Error("screenshot suspiciously small");
