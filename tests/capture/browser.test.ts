// tests/capture/browser.test.ts
import { test, expect, spyOn } from "bun:test";
import { isBrowserInstalled, newContext, launchBrowser, ENGINES } from "../../src/capture/browser";

test("isBrowserInstalled returns a boolean", () => {
  // We can't guarantee install state in CI; just assert the contract.
  expect(typeof isBrowserInstalled()).toBe("boolean");
});

test("newContext sets ignoreHTTPSErrors when insecure", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280, true);
  expect(opts.ignoreHTTPSErrors).toBe(true);
});

test("newContext defaults ignoreHTTPSErrors to false", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280);
  expect(opts.ignoreHTTPSErrors).toBe(false);
});

test("newContext sets extraHTTPHeaders when provided", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  const headers = { "CF-Access-Client-Id": "abc", "CF-Access-Client-Secret": "xyz" };
  await newContext(fakeBrowser, 1280, false, headers);
  expect(opts.extraHTTPHeaders).toEqual(headers);
});

test("newContext omits extraHTTPHeaders when given an empty object", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280, false, {});
  expect(opts).not.toHaveProperty("extraHTTPHeaders");
});

test("newContext omits extraHTTPHeaders when none provided", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280, false);
  expect(opts).not.toHaveProperty("extraHTTPHeaders");
});

test("launchBrowser selects the requested engine", async () => {
  const fakeBrowser = {} as any;
  const spy = spyOn(ENGINES.firefox, "launch").mockResolvedValue(fakeBrowser);
  const b = await launchBrowser("firefox");
  expect(b).toBe(fakeBrowser);
  expect(spy).toHaveBeenCalledWith({ headless: true });
  spy.mockRestore();
});

test("launchBrowser defaults to chromium", async () => {
  const fakeBrowser = {} as any;
  const spy = spyOn(ENGINES.chromium, "launch").mockResolvedValue(fakeBrowser);
  await launchBrowser();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

test("isBrowserInstalled checks the requested engine's path", () => {
  const spy = spyOn(ENGINES.webkit, "executablePath").mockReturnValue("");
  expect(isBrowserInstalled("webkit")).toBe(false);
  spy.mockRestore();
});
