// tests/store/db.test.ts
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { openDb, startRun, saveComparison, finishRun, readComparisons } from "../../src/store/db";
import type { ComparisonRecord } from "../../src/types";
import {
  writeSnapshot, readSnapshot, saveBaselineImage, readBaselineImages,
  clearBaseline, clearRuns,
} from "../../src/store/db";

const STAB = {
  waitUntil: "networkidle" as const, settleMs: 500, timeoutMs: 15000,
  disableAnimations: true, mask: [".ad"], remove: [".widget"],
};

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

test("readSnapshot returns null on a fresh DB", () => {
  const db = openDb(":memory:");
  expect(readSnapshot(db)).toBeNull();
});

test("writeSnapshot then readSnapshot round-trips meta", () => {
  const db = openDb(":memory:");
  writeSnapshot(db, {
    createdAt: "2026-07-04T00:00:00Z",
    prodBaseUrl: "https://www.example.com",
    viewports: [375, 1280],
    stabilize: STAB,
    configJson: '{"k":1}',
  });
  const s = readSnapshot(db)!;
  expect(s.prodBaseUrl).toBe("https://www.example.com");
  expect(s.viewports).toEqual([375, 1280]);
  expect(s.stabilize).toEqual(STAB);
  expect(s.configJson).toBe('{"k":1}');
});

test("writeSnapshot then readSnapshot round-trips the browser", () => {
  const db = openDb(":memory:");
  writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}", browser: "firefox" });
  expect(readSnapshot(db)!.browser).toBe("firefox");
});

test("readSnapshot defaults browser to chromium when the column is null", () => {
  const db = openDb(":memory:");
  // Simulate an old snapshot row written before the browser column existed.
  db.query(
    `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json)
     VALUES (1, 'a', 'https://one.com', '[1]', '{}', '{}')`,
  ).run();
  expect(readSnapshot(db)!.browser).toBe("chromium");
});

test("openDb migrates a pre-existing DB that lacks the snapshot.browser column", () => {
  // Use an on-disk file: the migration branch targets pre-existing DBs, which
  // :memory: can never represent (a fresh in-memory DB already has the column).
  const path = `${import.meta.dir}/.tmp-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
  const cleanup = () => {
    for (const p of [path, `${path}-wal`, `${path}-shm`]) rmSync(p, { force: true });
  };
  try {
    // Create an OLD-schema snapshot table WITHOUT the browser column, insert a row.
    const raw = new Database(path);
    raw.exec(
      `CREATE TABLE snapshot (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, prod_base_url TEXT NOT NULL, viewports_json TEXT NOT NULL, stabilize_json TEXT NOT NULL, config_json TEXT NOT NULL);`,
    );
    raw.query(
      `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json)
       VALUES (1, 'a', 'https://one.com', '[1]', '{}', '{}')`,
    ).run();
    raw.close();

    // Code under test: openDb must ALTER the table to add the browser column.
    const db = openDb(path);
    const cols = (db.query("PRAGMA table_info(snapshot)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("browser");
    expect(readSnapshot(db)!.browser).toBe("chromium");
    db.close();

    // Idempotency: opening the migrated file again must not throw and still reads back.
    const db2 = openDb(path);
    expect(readSnapshot(db2)!.browser).toBe("chromium");
    db2.close();
  } finally {
    cleanup();
  }
});

test("writeSnapshot replaces the single snapshot row", () => {
  const db = openDb(":memory:");
  writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}" });
  writeSnapshot(db, { createdAt: "b", prodBaseUrl: "https://two.com", viewports: [2], stabilize: STAB, configJson: "{}" });
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://two.com");
  expect((db.query("SELECT COUNT(*) AS n FROM snapshot").get() as { n: number }).n).toBe(1);
});

test("saveBaselineImage / readBaselineImages round-trips ok + error rows and BLOB bytes", () => {
  const db = openDb(":memory:");
  saveBaselineImage(db, { path: "/", viewport: 1280, prodUrl: "https://www.example.com/", image: new Uint8Array([9, 8, 7]), status: "ok" });
  saveBaselineImage(db, { path: "/x", viewport: 1280, prodUrl: "https://www.example.com/x", status: "error", error: "boom" });
  const rows = readBaselineImages(db);
  expect(rows.length).toBe(2);
  const ok = rows.find((r) => r.path === "/")!;
  const err = rows.find((r) => r.path === "/x")!;
  expect(Array.from(ok.image!)).toEqual([9, 8, 7]);
  expect(ok.status).toBe("ok");
  expect(err.image).toBeUndefined();
  expect(err.status).toBe("error");
  expect(err.error).toBe("boom");
});

test("clearBaseline empties both baseline tables but leaves it re-usable", () => {
  const db = openDb(":memory:");
  writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}" });
  saveBaselineImage(db, { path: "/", viewport: 1, prodUrl: "u", image: new Uint8Array([1]), status: "ok" });
  clearBaseline(db);
  expect(readSnapshot(db)).toBeNull();
  expect(readBaselineImages(db).length).toBe(0);
});

test("clearRuns empties runs and comparisons only", () => {
  const db = openDb(":memory:");
  startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "s" });
  writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}" });
  clearRuns(db);
  expect((db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n).toBe(0);
  expect(readSnapshot(db)).not.toBeNull(); // baseline untouched
});
