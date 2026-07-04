// tests/store/db.test.ts
import { test, expect } from "bun:test";
import { openDb, startRun, saveComparison, finishRun, readComparisons } from "../../src/store/db";
import type { ComparisonRecord } from "../../src/types";

test("start run, save comparison, read back", () => {
  const db = openDb(":memory:");
  const runId = startRun(db, {
    devBaseUrl: "https://dev.example.com",
    prodBaseUrl: "https://www.example.com",
    configJson: "{}",
    startedAt: "2026-07-03T00:00:00Z",
  });
  expect(runId).toBe(1);

  const rec: ComparisonRecord = {
    path: "/pricing", viewport: 1280,
    devUrl: "https://dev.example.com/pricing",
    prodUrl: "https://www.example.com/pricing",
    devImage: new Uint8Array([1, 2, 3]),
    prodImage: new Uint8Array([4, 5, 6]),
    diffImage: new Uint8Array([7, 8, 9]),
    width: 1280, height: 2000, diffPixels: 42, diffScore: 0.01,
    passed: true, status: "ok",
  };
  saveComparison(db, runId, rec);
  finishRun(db, runId, "complete", "2026-07-03T00:01:00Z");

  const rows = readComparisons(db, runId);
  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toBe("/pricing");
  expect(rows[0]!.diffScore).toBe(0.01);
  expect(rows[0]!.devImage).toBeInstanceOf(Uint8Array);
});
