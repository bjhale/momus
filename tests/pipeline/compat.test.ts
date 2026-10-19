// tests/pipeline/compat.test.ts
import { test, expect } from "bun:test";
import { baselineConflict } from "../../src/pipeline/compat";
import { setupIdentity } from "../../src/config/redact";
import { ConfigSchema } from "../../src/config/schema";
import type { SnapshotMeta } from "../../src/store/db";

function cfg(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280], ...over });
}

function snapFrom(c: ReturnType<typeof cfg>): SnapshotMeta {
  return { createdAt: "t", prodBaseUrl: c.prod, viewports: c.viewports, stabilize: c.stabilize, configJson: "{}", browser: c.browser, setupJson: setupIdentity(c) };
}

test("differing browser → conflict mentioning browser", () => {
  const c = cfg({ browser: "firefox" });
  const snap = snapFrom(cfg({ browser: "chromium" }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("browser");
});

test("matching browser → no browser conflict", () => {
  const c = cfg({ browser: "webkit" });
  expect(baselineConflict(c, snapFrom(c))).toBeNull();
});

test("matching viewports + stabilize → no conflict", () => {
  const c = cfg();
  expect(baselineConflict(c, snapFrom(c))).toBeNull();
});

test("differing viewports → conflict mentioning viewports", () => {
  const c = cfg({ viewports: [768] });
  const snap = snapFrom(cfg({ viewports: [375, 1280] }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("viewport");
});

test("differing stabilize.mask → conflict mentioning stabilize", () => {
  const c = cfg({ stabilize: { mask: [".new"] } });
  const snap = snapFrom(cfg({ stabilize: { mask: [".old"] } }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("stabilize");
  expect(msg!.toLowerCase()).toContain("mask");
});

test("differing stabilize.settleMs → conflict", () => {
  const c = cfg({ stabilize: { settleMs: 100 } });
  const snap = snapFrom(cfg({ stabilize: { settleMs: 999 } }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("settlems");
});

test("differing stabilize.remove → conflict naming remove", () => {
  const c = cfg({ stabilize: { remove: [".new"] } });
  const snap = snapFrom(cfg({ stabilize: { remove: [".old"] } }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("remove");
});

test("a baseline snapshot missing 'remove' does not conflict with a default (empty) config remove", () => {
  const c = cfg(); // remove defaults to []
  const snap = snapFrom(cfg());
  // Simulate a baseline snapshotted before this feature: its stored stabilize
  // has no `remove` key.
  delete (snap.stabilize as { remove?: string[] }).remove;
  expect(baselineConflict(c, snap)).toBeNull();
});

test("a different prod origin → conflict naming both origins and the fix", () => {
  const msg = baselineConflict(cfg({ prod: "https://other.example.com" }), snapFrom(cfg()));
  expect(msg).toContain('prod origin differs: config "https://other.example.com" vs baseline "https://www.example.com"');
  expect(msg).toContain("--snapshot");
  expect(msg).toContain("output.db");
});

test("same origin with a different path or trailing slash → no conflict", () => {
  const snap = snapFrom(cfg());
  expect(baselineConflict(cfg({ prod: "https://www.example.com/" }), snap)).toBeNull();
  expect(baselineConflict(cfg({ prod: "https://www.example.com/en/" }), snap)).toBeNull();
});

test("a different port or scheme is a different origin", () => {
  const snap = snapFrom(cfg());
  expect(baselineConflict(cfg({ prod: "http://www.example.com" }), snap)).toContain("prod origin differs");
  expect(baselineConflict(cfg({ prod: "https://www.example.com:8443" }), snap)).toContain("prod origin differs");
});

test("a changed prod setup is a conflict; a changed dev setup is not", () => {
  const login = (sel: string) => ({ steps: [{ goto: "/login" }, { click: sel }] });
  const baseline = cfg({ setup: { dev: login("a"), prod: login("a") } });
  expect(baselineConflict(cfg({ setup: { dev: login("b"), prod: login("a") } }), snapFrom(baseline))).toBeNull();
  expect(baselineConflict(cfg({ setup: { dev: login("a"), prod: login("b") } }), snapFrom(baseline)))
    .toContain("prod setup differs");
});

test("adding or removing setup is a conflict", () => {
  const withSetup = cfg({ setup: { storageState: "a.json" } });
  expect(baselineConflict(withSetup, snapFrom(cfg()))).toContain("prod setup differs");
  expect(baselineConflict(cfg(), snapFrom(withSetup))).toContain("prod setup differs");
});

test("a baseline from before setup existed (no setupJson) matches a config without setup", () => {
  const c = cfg();
  const { setupJson: _omit, ...old } = snapFrom(c);
  expect(baselineConflict(c, old)).toBeNull();
});

/** A baseline captured before RFC-0006: its stabilize has none of the new keys. */
function preRfc(c: ReturnType<typeof cfg>): SnapshotMeta {
  const { waitForImages, clock, reducedMotion, colorScheme, verify, ...old } = c.stabilize;
  return { ...snapFrom(c), stabilize: old };
}

test("a default config refuses a pre-RFC-0006 baseline, saying how to re-capture", () => {
  const c = cfg();
  const msg = baselineConflict(c, preRfc(c))!;
  expect(msg).toContain("stabilize.");
  expect(msg).toContain("predates this setting");
  expect(msg).toContain("momus snapshot");
});

test("stabilize.reducedMotion: an old baseline reads as no-preference", () => {
  const c = cfg({ stabilize: { waitForImages: false } });
  const msg = baselineConflict(c, preRfc(c))!;
  expect(msg).toContain("stabilize.reducedMotion");
  expect(msg).toContain('"no-preference"');
  expect(msg).toContain("momus snapshot");
  const same = cfg({ stabilize: { waitForImages: false, reducedMotion: "no-preference" } });
  expect(baselineConflict(same, preRfc(same))).toBeNull();
});

test("stabilize.waitForImages: an old baseline reads as false", () => {
  const c = cfg({ stabilize: { reducedMotion: "no-preference" } });
  const msg = baselineConflict(c, preRfc(c))!;
  expect(msg).toContain("stabilize.waitForImages");
  expect(msg).toContain("false");
});

test("stabilize.colorScheme: an old baseline reads as light; a change conflicts", () => {
  const c = cfg({ stabilize: { reducedMotion: "no-preference", waitForImages: false } });
  expect(baselineConflict(c, preRfc(c))).toBeNull();
  const dark = cfg({ stabilize: { reducedMotion: "no-preference", waitForImages: false, colorScheme: "dark" } });
  const msg = baselineConflict(dark, preRfc(c))!;
  expect(msg).toContain("stabilize.colorScheme");
  expect(msg).toContain('"dark"');
});

test("stabilize.clock: an old baseline reads as unset; a changed clock conflicts", () => {
  const old = cfg({ stabilize: { reducedMotion: "no-preference", waitForImages: false } });
  const c = cfg({ stabilize: { reducedMotion: "no-preference", waitForImages: false, clock: "2026-01-01T00:00:00Z" } });
  expect(baselineConflict(c, preRfc(old))!).toContain("stabilize.clock");
  const later = cfg({ stabilize: { clock: "2027-01-01T00:00:00Z" } });
  expect(baselineConflict(later, snapFrom(cfg({ stabilize: { clock: "2026-01-01T00:00:00Z" } })))!).toContain("stabilize.clock");
});

test("verify and retries don't change pixels, so they're not gated", () => {
  const c = cfg({ stabilize: { verify: true }, retries: 3 });
  expect(baselineConflict(c, snapFrom(cfg()))).toBeNull();
});

test("rendering: pinned vs host conflicts both ways; an old baseline reads as host", () => {
  const c = cfg();
  const msg = baselineConflict(c, { ...snapFrom(c), rendering: "host" }, "pinned")!;
  expect(msg).toContain("rendering");
  expect(msg).toContain('"pinned"');
  expect(msg).toContain('"host"');
  expect(baselineConflict(c, { ...snapFrom(c), rendering: "pinned" }, "host")).not.toBeNull();
  expect(baselineConflict(c, snapFrom(c), "host")).toBeNull();
  expect(baselineConflict(c, { ...snapFrom(c), rendering: "pinned" }, "pinned")).toBeNull();
});

test("a pinned run against a host baseline explains that older baselines read as host", () => {
  const c = cfg();
  const msg = baselineConflict(c, snapFrom(c), "pinned")!;
  expect(msg).toContain("predates pinned rendering");
  expect(msg).toContain("momus snapshot");
});
