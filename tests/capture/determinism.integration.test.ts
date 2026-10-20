// tests/capture/determinism.integration.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { PNG } from "pngjs";
import { launchBrowser } from "../../src/capture/browser";
import { capture, type StabilizeOptions } from "../../src/capture/screenshot";
import { launchable } from "../helpers/engines";

const installed = await launchable("chromium");
const maybe = installed ? test : test.skip;

const STAB: StabilizeOptions = {
  waitUntil: "load", settleMs: 0, timeoutMs: 10000, disableAnimations: true, mask: [], remove: [],
  waitForImages: true, reducedMotion: "reduce", colorScheme: "light",
};

// A 50×300 red PNG: tall enough that a capture visibly grows when it's laid out.
const TALL = PNG.sync.write(Object.assign(new PNG({ width: 50, height: 300 }), {
  data: Buffer.alloc(50 * 300 * 4, Buffer.from([255, 0, 0, 255])),
}));

const pages: Record<string, string> = {
  "/media": `<style>body{margin:0;background:#00f} @media (prefers-reduced-motion: reduce){body{background:#f00}}
    @media (prefers-color-scheme: dark){body{background:#0f0}}</style><div style="height:50px"></div>`,
  "/date": `<body style="margin:0"><div id="d" style="font:40px monospace"></div>
    <script>document.getElementById("d").textContent = new Date().toISOString()</script></body>`,
  // Every scroll appends more page: autoScroll never reaches the bottom.
  "/infinite": `<body style="margin:0"><div id="c" style="height:2000px"></div>
    <script>addEventListener("scroll", () => { const c = document.getElementById("c"); c.style.height = (c.offsetHeight + 2000) + "px"; })</script></body>`,
  // Below the lazy-load distance, so the image is first requested by autoScroll.
  // The page already reached networkidle by then, and that state is sticky.
  "/lazy": `<body style="margin:0"><div style="height:6000px"></div><img loading="lazy" src="/slow.png" style="display:block"></body>`,
  // Never requested: a lazy image inside display:none never loads or errors.
  "/hidden-lazy": `<body style="margin:0"><div style="display:none"><img loading="lazy" src="/slow.png"></div><p>visible</p></body>`,
  "/lazy-never": `<body style="margin:0"><div style="height:6000px"></div><img loading="lazy" src="/never.png" style="display:block"></body>`,
};

let server: ReturnType<typeof Bun.serve>;
// One browser per file: launching is the slow part.
let browser: Awaited<ReturnType<typeof launchBrowser>>;
beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/slow.png") {
        await Bun.sleep(800);
        return new Response(new Uint8Array(TALL), { headers: { "content-type": "image/png" } });
      }
      if (path === "/never.png") return new Promise<Response>(() => {}); // stop(true) ends it
      const body = pages[path];
      return body === undefined
        ? new Response("not found", { status: 404 })
        : new Response(`<!doctype html><html>${body}</html>`, { headers: { "content-type": "text/html" } });
    },
  });
  if (installed) browser = await launchBrowser();
});
// Server first: stop(true) drops the /never.png request still open.
afterAll(async () => {
  await server.stop(true);
  await browser?.close();
});

const url = (p: string) => `http://localhost:${server.port}${p}`;
const decode = (png: Uint8Array) => PNG.sync.read(Buffer.from(png));
function topLeft(png: Uint8Array): number[] {
  const img = decode(png);
  return [img.data[0]!, img.data[1]!, img.data[2]!];
}

maybe("reducedMotion: reduce is visible to the page's media queries", async () => {
  const res = await capture(browser, url("/media"), 375, STAB);
  expect(res.ok).toBe(true);
  expect(topLeft(res.png!)).toEqual([255, 0, 0]);
});

maybe("colorScheme: dark is visible to the page's media queries", async () => {
  const res = await capture(browser, url("/media"), 375, { ...STAB, reducedMotion: "no-preference", colorScheme: "dark" });
  expect(topLeft(res.png!)).toEqual([0, 255, 0]);
});

maybe("clock pins Date, so a page that prints the time captures identically", async () => {
  const opts = { ...STAB, clock: "2026-01-01T00:00:00Z" };
  const a = await capture(browser, url("/date"), 375, opts);
  await Bun.sleep(1100);
  const b = await capture(browser, url("/date"), 375, opts);
  expect(a.ok && b.ok).toBe(true);
  expect(Buffer.from(a.png!).equals(Buffer.from(b.png!))).toBe(true);
});

maybe("clock doesn't stop autoScroll from ending on an infinite-scroll page", async () => {
  const t0 = Date.now();
  const res = await capture(browser, url("/infinite"), 375, { ...STAB, clock: "2026-01-01T00:00:00Z", timeoutMs: 3000 });
  expect(res.ok).toBe(true);
  expect(Date.now() - t0).toBeLessThan(6000);
});

maybe("waitForImages waits for a lazy image that scrolling requested", async () => {
  const res = await capture(browser, url("/lazy"), 375, { ...STAB, waitUntil: "networkidle" });
  expect(res.ok).toBe(true);
  expect(decode(res.png!).height).toBeGreaterThanOrEqual(6300);
});

maybe("waitForImages gives up on an image that never loads, within timeoutMs", async () => {
  const t0 = Date.now();
  const res = await capture(browser, url("/lazy-never"), 375, { ...STAB, waitUntil: "networkidle", timeoutMs: 3000 });
  expect(res.ok).toBe(true);
  expect(Date.now() - t0).toBeLessThan(6000);
});

maybe("waitForImages doesn't wait for an image that isn't rendered", async () => {
  const t0 = Date.now();
  const res = await capture(browser, url("/hidden-lazy"), 375, { ...STAB, timeoutMs: 10000 });
  expect(res.ok).toBe(true);
  expect(Date.now() - t0).toBeLessThan(5000);
});
