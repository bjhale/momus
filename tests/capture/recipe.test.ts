// tests/capture/recipe.test.ts
import { test, expect } from "bun:test";
import type { Browser } from "playwright-core";
import { capture } from "../../src/capture/screenshot";

const opts = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 1000, disableAnimations: true, mask: [], remove: [] };
const noBrowser = { newContext: () => { throw new Error("must not open a context"); } } as unknown as Browser;

test("a malformed recipe is an error result, not a throw, and opens no context", async () => {
  const res = await capture(noBrowser, "http://x/", 1280, opts, false, undefined, { recipe: { steps: [{ tap: "x" }] } });
  expect(res.ok).toBe(false);
  expect(res.error).toStartWith("invalid recipe");
});
