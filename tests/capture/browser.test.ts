// tests/capture/browser.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, newContext } from "../../src/capture/browser";

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
