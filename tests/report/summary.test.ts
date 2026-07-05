// tests/report/summary.test.ts
import { test, expect } from "bun:test";
import { summarize, itemClass } from "../../src/report/summary";
import type { ComparisonRecord } from "../../src/types";

function ok(path: string, vp: number, score: number, passed: boolean): ComparisonRecord {
  return { path, viewport: vp, devUrl: "d", prodUrl: "p", diffScore: score, passed, status: "ok" };
}
function err(path: string, vp: number): ComparisonRecord {
  return { path, viewport: vp, devUrl: "d", prodUrl: "p", status: "error", error: "boom" };
}

test("counts, verdict, worst, viewports", () => {
  const s = summarize([
    ok("/a", 1280, 0.02, false), // fail
    ok("/b", 375, 0.001, true),  // pass
    ok("/c", 768, 0.18, false),  // fail, worst
    err("/d", 1280),             // error
  ]);
  expect(s.total).toBe(4);
  expect(s.passed).toBe(1);
  expect(s.failed).toBe(2);
  expect(s.errored).toBe(1);
  expect(s.verdict).toBe("FAIL");
  expect(s.worst).toEqual({ path: "/c", viewport: 768, pct: "18.00" });
  expect(s.viewports).toEqual([375, 768, 1280]);
});

test("verdict is PASS only when all comparisons pass", () => {
  expect(summarize([ok("/a", 1280, 0, true), ok("/b", 1280, 0, true)]).verdict).toBe("PASS");
  expect(summarize([ok("/a", 1280, 0, true), err("/b", 1280)]).verdict).toBe("FAIL");
  expect(summarize([ok("/a", 1280, 0.1, false)]).verdict).toBe("FAIL");
});

test("worst is omitted when there are no ok comparisons", () => {
  const s = summarize([err("/a", 1280), err("/b", 375)]);
  expect(s.worst).toBeUndefined();
  expect(s.errored).toBe(2);
  expect(s.viewports).toEqual([375, 1280]);
});

test("itemClass maps status/passed", () => {
  expect(itemClass(ok("/a", 1280, 0, true))).toBe("pass");
  expect(itemClass(ok("/a", 1280, 0.1, false))).toBe("fail");
  expect(itemClass(err("/a", 1280))).toBe("error");
});
