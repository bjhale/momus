// tests/capture/browser.test.ts
import { test, expect, spyOn } from "bun:test";
import { isBrowserInstalled, newContext, launchBrowser, ENGINES, renderingMode, PINNED_CHROMIUM_ARGS } from "../../src/capture/browser";

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

test("newContext passes reducedMotion and colorScheme through", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280, false, undefined, { reducedMotion: "reduce", colorScheme: "dark" });
  expect(opts.reducedMotion).toBe("reduce");
  expect(opts.colorScheme).toBe("dark");
});

test("renderingMode reads MOMUS_RENDERING; unset or empty is host", () => {
  expect(renderingMode({})).toBe("host");
  expect(renderingMode({ MOMUS_RENDERING: "" })).toBe("host");
  expect(renderingMode({ MOMUS_RENDERING: "host" })).toBe("host");
  expect(renderingMode({ MOMUS_RENDERING: "pinned" })).toBe("pinned");
});

test("renderingMode refuses any other value rather than guess", () => {
  expect(() => renderingMode({ MOMUS_RENDERING: "true" })).toThrow('MOMUS_RENDERING must be "pinned" or "host", got "true"');
  expect(() => renderingMode({ MOMUS_RENDERING: "Pinned" })).toThrow('got "Pinned"');
});

test("pinned chromium launches with the pinned flags; host launches without", async () => {
  const spy = spyOn(ENGINES.chromium, "launch").mockResolvedValue({} as any);
  await launchBrowser("chromium", "pinned");
  expect(spy).toHaveBeenLastCalledWith({ headless: true, args: PINNED_CHROMIUM_ARGS });
  await launchBrowser("chromium", "host");
  expect(spy).toHaveBeenLastCalledWith({ headless: true });
  spy.mockRestore();
  expect(PINNED_CHROMIUM_ARGS).toContain("--disable-gpu");
});

test("pinned firefox and webkit add no chromium flags", async () => {
  const spy = spyOn(ENGINES.firefox, "launch").mockResolvedValue({} as any);
  await launchBrowser("firefox", "pinned");
  expect(spy).toHaveBeenLastCalledWith({ headless: true });
  spy.mockRestore();
});
