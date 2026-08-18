// tests/capture/screenshot.test.ts
import { test, expect } from "bun:test";
import { capture } from "../../src/capture/screenshot";

const STAB = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 1000, disableAnimations: true, mask: [], remove: [] };

// A fake browser whose context throws on newPage, so capture returns {ok:false}
// AFTER recording the context options — lets us assert the insecure threading
// without a real Chromium.
function fakeBrowser(record: (o: any) => void) {
  return {
    newContext: async (o: any) => {
      record(o);
      return { newPage: async () => { throw new Error("stop after context"); }, close: async () => {} };
    },
  } as any;
}

test("capture threads insecure through to the browser context", async () => {
  let opts: any;
  const res = await capture(fakeBrowser((o) => { opts = o; }), "https://x.example", 1280, STAB, true);
  expect(opts.ignoreHTTPSErrors).toBe(true);
  expect(res.ok).toBe(false); // newPage threw → recorded as error, never propagated
});

test("capture defaults to a secure context", async () => {
  let opts: any;
  await capture(fakeBrowser((o) => { opts = o; }), "https://x.example", 1280, STAB);
  expect(opts.ignoreHTTPSErrors).toBe(false);
});

// A fake browser that hands back a page recording every page.route() handler,
// then throws on goto so capture returns {ok:false} AFTER the routes are
// installed. Lets us drive the handler directly with synthetic requests.
function fakeRoutingBrowser(handlers: Function[]) {
  return {
    newContext: async () => ({
      newPage: async () => ({
        route: async (_pattern: string, handler: Function) => { handlers.push(handler); },
        goto: async () => { throw new Error("stop after route"); },
      }),
      close: async () => {},
    }),
  } as any;
}

/** Run the installed route handler against one request; return what it passed
 * to route.continue() (undefined = continued untouched). */
async function routeOnce(handler: Function, url: string, headers: Record<string, string>) {
  let passed: any = "not-called";
  const route = { continue: (arg?: any) => { passed = arg; } };
  const request = { url: () => url, headers: () => headers };
  await handler(route, request);
  return passed;
}

const AUTH = { "CF-Access-Client-Id": "abc", "CF-Access-Client-Secret": "xyz" };

test("capture sends requestHeaders on same-origin requests", async () => {
  const handlers: Function[] = [];
  await capture(fakeRoutingBrowser(handlers), "https://x.example/page", 1280, STAB, false, AUTH);
  expect(handlers).toHaveLength(1);
  const passed = await routeOnce(handlers[0]!, "https://x.example/style.css", { "user-agent": "test" });
  expect(passed.headers).toEqual({ "user-agent": "test", ...AUTH });
});

test("capture matches origin, not just hostname, when scoping headers", async () => {
  const handlers: Function[] = [];
  await capture(fakeRoutingBrowser(handlers), "https://x.example/page", 1280, STAB, false, AUTH);
  // Same host, different scheme → a different origin, so auth must not leak.
  const passed = await routeOnce(handlers[0]!, "http://x.example/style.css", { "user-agent": "test" });
  expect(passed).toBeUndefined();
});

test("capture withholds requestHeaders from cross-origin requests", async () => {
  const handlers: Function[] = [];
  await capture(fakeRoutingBrowser(handlers), "https://x.example/page", 1280, STAB, false, AUTH);
  // Regression guard: sending auth headers to a font CDN triggers a CORS
  // preflight the CDN rejects, silently blocking the web font download.
  const passed = await routeOnce(handlers[0]!, "https://fonts.gstatic.com/f.woff2", { "user-agent": "test" });
  expect(passed).toBeUndefined();
});

test("capture installs no route handler when requestHeaders is empty", async () => {
  const handlers: Function[] = [];
  await capture(fakeRoutingBrowser(handlers), "https://x.example/page", 1280, STAB, false, {});
  expect(handlers).toHaveLength(0);
});

test("capture installs no route handler when requestHeaders is omitted", async () => {
  const handlers: Function[] = [];
  await capture(fakeRoutingBrowser(handlers), "https://x.example/page", 1280, STAB, false);
  expect(handlers).toHaveLength(0);
});
