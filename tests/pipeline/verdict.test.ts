// tests/pipeline/verdict.test.ts
import { test, expect } from "bun:test";
import { resolveFailScore, passed, exitCodeFor } from "../../src/pipeline/verdict";
import type { ComparisonRecord } from "../../src/types";

const overrides = [{ path: "/blog/**", failScore: 0.05 }];

test("override applies to matching path, else global", () => {
  expect(resolveFailScore("/blog/x", 0.01, overrides)).toBe(0.05);
  expect(resolveFailScore("/pricing", 0.01, overrides)).toBe(0.01);
});

test("passed compares score to fail threshold", () => {
  expect(passed(0.005, 0.01)).toBe(true);
  expect(passed(0.02, 0.01)).toBe(false);
});

test("exit code: 0 all ok+pass, 1 on fail or error", () => {
  const ok: ComparisonRecord = { path: "/", viewport: 1, devUrl: "", prodUrl: "", status: "ok", passed: true };
  const fail: ComparisonRecord = { ...ok, passed: false };
  const err: ComparisonRecord = { path: "/", viewport: 1, devUrl: "", prodUrl: "", status: "error" };
  expect(exitCodeFor([ok])).toBe(0);
  expect(exitCodeFor([ok, fail])).toBe(1);
  expect(exitCodeFor([ok, err])).toBe(1);
});
