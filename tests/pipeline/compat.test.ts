// tests/pipeline/compat.test.ts
import { test, expect } from "bun:test";
import { baselineConflict } from "../../src/pipeline/compat";
import { ConfigSchema } from "../../src/config/schema";
import type { SnapshotMeta } from "../../src/store/db";

function cfg(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280], ...over });
}

function snapFrom(c: ReturnType<typeof cfg>): SnapshotMeta {
  return { createdAt: "t", prodBaseUrl: c.prod, viewports: c.viewports, stabilize: c.stabilize, configJson: "{}" };
}

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
});

test("differing stabilize.settleMs → conflict", () => {
  const c = cfg({ stabilize: { settleMs: 100 } });
  const snap = snapFrom(cfg({ stabilize: { settleMs: 999 } }));
  expect(baselineConflict(c, snap)).not.toBeNull();
});
