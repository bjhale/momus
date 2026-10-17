// tests/capture/recipe.integration.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { PNG } from "pngjs";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";

const installed = isBrowserInstalled();
const maybe = installed ? test : test.skip;
// Shared per file: each browser launch/close cycle risks Bun's intermittent
// child-process hang on close, so launch once. Isolation holds because every
// capture and setup opens its own browser context.
let browser: Awaited<ReturnType<typeof launchBrowser>>;
beforeAll(async () => { if (installed) browser = await launchBrowser(); });
afterAll(async () => { await browser?.close(); });
const opts = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 5000, disableAnimations: true, mask: [], remove: [] };

const PAGE = `<html><body style="margin:0">
  <button aria-label="Menu" onclick="document.querySelector('nav').dataset.open=''">menu</button>
  <nav style="display:none;width:300px;height:120px;background:#c00">nav</nav>
  <style>nav[data-open]{display:block !important}</style>
  <p id="who"></p><script>document.getElementById('who').textContent = document.cookie;</script>
</body></html>`;

function site() {
  return Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }) });
}

maybe("steps run before capture, and capture.element screenshots that element", async () => {
  const server = site();
  try {
    const res = await capture(browser, `http://localhost:${server.port}/`, 1280, opts, false, undefined, {
      recipe: { steps: [{ click: "button[aria-label=Menu]" }, { waitFor: "nav[data-open]" }], capture: { element: "nav" } },
    });
    expect(res.error).toBeUndefined();
    const img = PNG.sync.read(Buffer.from(res.png!));
    expect([img.width, img.height]).toEqual([300, 120]);
  } finally { server.stop(); }
});

maybe("an element that matches nothing errors; it never falls back to the full page", async () => {
  const server = site();
  try {
    const res = await capture(browser, `http://localhost:${server.port}/`, 1280, opts, false, undefined,
      { recipe: { steps: [], capture: { element: "#nope" } } });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('capture.element "#nope" matched nothing');
  } finally { server.stop(); }
});

maybe("a failing step is an error result naming the step", async () => {
  const server = site();
  try {
    const res = await capture(browser, `http://localhost:${server.port}/`, 1280, { ...opts, timeoutMs: 300 }, false, undefined,
      { recipe: { steps: [{ click: "#absent" }] } });
    expect(res.ok).toBe(false);
    expect(res.error).toStartWith('step 1: click "#absent": ');
  } finally { server.stop(); }
});

maybe("a storage state is loaded into the capture context", async () => {
  const server = site();
  try {
    const res = await capture(browser, `http://localhost:${server.port}/`, 1280, opts, false, undefined, {
      recipe: { steps: [], capture: { element: "#who" } },
      storageState: { cookies: [{ name: "session", value: "abc", domain: "localhost", path: "/",
        expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] },
    });
    expect(res.ok).toBe(true);
    // The element only has a box when the cookie text rendered.
    expect(PNG.sync.read(Buffer.from(res.png!)).height).toBeGreaterThan(0);
  } finally { server.stop(); }
});
