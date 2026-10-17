// tests/pipeline/verdict.test.ts
import { test, expect } from "bun:test";
import { resolveFailScore, passed, exitCodeFor, failsGate } from "../../src/pipeline/verdict";
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

const rec = (status: "ok" | "error" | "added" | "removed", passed?: boolean) =>
  ({ path: "/x", viewport: 1280, devUrl: "", prodUrl: "", status, passed });

test("added and removed fail the gate by default", () => {
  expect(exitCodeFor([rec("added")])).toBe(1);
  expect(exitCodeFor([rec("removed")])).toBe(1);
});

test("allowAdded / allowRemoved make each informational, independently", () => {
  expect(exitCodeFor([rec("added")], { allowAdded: true, allowRemoved: false })).toBe(0);
  expect(exitCodeFor([rec("removed")], { allowAdded: true, allowRemoved: false })).toBe(1);
  expect(exitCodeFor([rec("removed")], { allowAdded: false, allowRemoved: true })).toBe(0);
});

test("allow flags never excuse an error or a diff failure", () => {
  const all = { allowAdded: true, allowRemoved: true };
  expect(exitCodeFor([rec("error")], all)).toBe(1);
  expect(exitCodeFor([rec("ok", false)], all)).toBe(1);
  expect(failsGate(rec("ok", true), all)).toBe(false);
});
