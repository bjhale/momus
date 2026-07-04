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
  // Assert exact BLOB byte content round-trips (catches truncation/offset/corruption).
  expect(Array.from(rows[0]!.devImage!)).toEqual([1, 2, 3]);
  expect(Array.from(rows[0]!.prodImage!)).toEqual([4, 5, 6]);
  expect(Array.from(rows[0]!.diffImage!)).toEqual([7, 8, 9]);
});

test("startRun overwrites the prior single run", () => {
  const db = openDb(":memory:");

  const firstRunId = startRun(db, {
    devBaseUrl: "https://dev.example.com",
    prodBaseUrl: "https://www.example.com",
    configJson: "{}",
    startedAt: "2026-07-03T00:00:00Z",
  });
  const oldRec: ComparisonRecord = {
    path: "/old", viewport: 1280,
    devUrl: "https://dev.example.com/old",
    prodUrl: "https://www.example.com/old",
    width: 1280, height: 2000, diffPixels: 10, diffScore: 0.5,
    passed: false, status: "ok",
  };
  saveComparison(db, firstRunId, oldRec);
  finishRun(db, firstRunId, "complete", "2026-07-03T00:01:00Z");
  expect(readComparisons(db, firstRunId).length).toBe(1);

  // Second run (new urls) must clear all prior comparisons via the DELETE overwrite.
  const secondRunId = startRun(db, {
    devBaseUrl: "https://dev2.example.com",
    prodBaseUrl: "https://www2.example.com",
    configJson: "{}",
    startedAt: "2026-07-03T01:00:00Z",
  });
  expect(secondRunId).toBe(1);
  expect(readComparisons(db, secondRunId).length).toBe(0);

  // A freshly saved comparison in the new run is the only one present.
  const newRec: ComparisonRecord = {
    path: "/new", viewport: 1280,
    devUrl: "https://dev2.example.com/new",
    prodUrl: "https://www2.example.com/new",
    width: 1280, height: 2000, diffPixels: 5, diffScore: 0.1,
    passed: true, status: "ok",
  };
  saveComparison(db, secondRunId, newRec);
  const rows = readComparisons(db, secondRunId);
  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toBe("/new");
});
