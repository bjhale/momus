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
