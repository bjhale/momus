// tests/capture/lazy.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { autoScroll } from "../../src/capture/screenshot";

const maybe = isBrowserInstalled() ? test : test.skip;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const IMG_DATA = `data:image/png;base64,${PNG.toString("base64")}`;

// Serve a tall page with two below-the-fold lazy images: one driven by an
// IntersectionObserver (JS lazy-load) and one native `loading="lazy"` pointing
// at a delayed endpoint (so it is genuinely deferred).
function serve() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/native.png") {
        await Bun.sleep(100);
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      }
      const html = `<!doctype html><html><body style="margin:0">
        <div style="height:3000px"></div>
        <img id="io" data-src="${IMG_DATA}" style="width:50px;height:50px">
        <img id="native" loading="lazy" src="/native.png" style="width:50px;height:50px">
        <script>
          const i = document.getElementById('io');
          new IntersectionObserver((es, o) => {
            for (const e of es) if (e.isIntersecting) { i.src = i.dataset.src; o.disconnect(); }
          }).observe(i);
        </script>
      </body></html>`;
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });
}

const loaded = (page: import("playwright-core").Page, id: string) =>
  page.evaluate((sel) => {
    const i = document.getElementById(sel) as HTMLImageElement | null;
    return !!i && i.complete && i.naturalWidth > 0;
  }, id);

maybe("autoScroll triggers below-the-fold lazy images (IntersectionObserver + native)", async () => {
  const server = serve();
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${server.port}/`, { waitUntil: "load" });

    // The IntersectionObserver image is NOT loaded before scrolling (the bug).
    expect(await loaded(page, "io")).toBe(false);

    await autoScroll(page, 5000);
    await page.waitForLoadState("networkidle").catch(() => {});

    // Both are loaded after the scroll pass.
    expect(await loaded(page, "io")).toBe(true);
    expect(await loaded(page, "native")).toBe(true);
    await ctx.close();
  } finally {
    await browser.close();
    server.stop();
  }
});

maybe("autoScroll returns the viewport to the top", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.setContent(`<div style="height:5000px"></div>`);
    await autoScroll(page, 3000);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await ctx.close();
  } finally {
    await browser.close();
  }
});
