// tests/capture/screenshot.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";

const maybe = isBrowserInstalled() ? test : test.skip;

maybe("captures a full-page PNG from a local server", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(
      "<html><body style='height:2000px'><h1>hi</h1></body></html>",
      { headers: { "content-type": "text/html" } }),
  });
  const url = `http://localhost:${server.port}/`;
  const browser = await launchBrowser();
  try {
    const res = await capture(browser, url, 1280, {
      waitUntil: "load", settleMs: 0, timeoutMs: 10000,
      disableAnimations: true, mask: [],
    });
    expect(res.ok).toBe(true);
    expect(res.png!.length).toBeGreaterThan(1000);
  } finally {
    await browser.close();
    server.stop();
  }
});

maybe("returns {ok:false} instead of throwing when the browser is closed", async () => {
  const browser = await launchBrowser();
  await browser.close();
  const res = await capture(browser, "http://localhost:1/", 1280, {
    waitUntil: "load", settleMs: 0, timeoutMs: 10000,
    disableAnimations: true, mask: [],
  });
  expect(res.ok).toBe(false);
});

maybe("records a 404 as an error, not a capture", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("missing", { status: 404 }),
  });
  const url = `http://localhost:${server.port}/nope`;
  const browser = await launchBrowser();
  try {
    const res = await capture(browser, url, 1280, {
      waitUntil: "load", settleMs: 0, timeoutMs: 10000,
      disableAnimations: true, mask: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("404");
  } finally {
    await browser.close();
    server.stop();
  }
});
