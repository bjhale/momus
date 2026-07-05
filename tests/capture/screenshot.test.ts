// tests/capture/screenshot.test.ts
import { test, expect } from "bun:test";
import { capture } from "../../src/capture/screenshot";

const STAB = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 1000, disableAnimations: true, mask: [] };

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
