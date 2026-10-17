// tests/store/db.test.ts
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  openDb as openDbRaw, startRun, saveComparison, finishRun, readComparisons,
  latestRunId, listRunIds, readRun, pruneRuns,
} from "../../src/store/db";
import type { ComparisonRecord } from "../../src/types";
import {
  writeSnapshot, readSnapshot, saveBaselineImage, readBaselineImages,
  clearBaseline, type BaselineImageRow,
} from "../../src/store/db";

// Every handle is closed at test end, even when an assertion throws first.
const opened: Database[] = [];
const openDb = (path: string): Database => { const d = openDbRaw(path); opened.push(d); return d; };
let dir = "";
afterEach(() => {
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

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

const RUN = { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "s" };

test("startRun keeps earlier runs and returns increasing ids", () => {
  const db = openDb(":memory:");
  const a = startRun(db, RUN);
  saveComparison(db, a, { path: "/a", viewport: 1, devUrl: "d", prodUrl: "p", status: "ok" });
  const b = startRun(db, RUN);
  expect(b).toBeGreaterThan(a);
  expect(readComparisons(db, a).length).toBe(1);
  expect(readComparisons(db, b).length).toBe(0);
  expect(latestRunId(db)).toBe(b);
  expect(listRunIds(db)).toEqual([a, b]);
});

test("latestRunId is null on a fresh DB", () => {
  expect(latestRunId(openDb(":memory:"))).toBeNull();
});

test("run provenance round-trips", () => {
  const db = openDb(":memory:");
  const id = startRun(db, {
    ...RUN, momusVersion: "1.2.3", engine: "firefox", engineVersion: "140.0", configHash: "abc",
    baselineId: 4, baselineJson: '{"x":1}', allowAdded: true, allowRemoved: false,
    ci: { commit: "deadbeef", branch: "main", pr: "42" },
  });
  finishRun(db, id, "complete", "f");
  expect(readRun(db, id)).toEqual({
    id, startedAt: "s", finishedAt: "f", status: "complete", devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}",
    momusVersion: "1.2.3", engine: "firefox", engineVersion: "140.0", configHash: "abc",
    baselineId: 4, baselineJson: '{"x":1}', allowAdded: true, allowRemoved: false,
    ci: { commit: "deadbeef", branch: "main", pr: "42" },
  });
});

test("a run without provenance reads with defaults; a missing run is null", () => {
  const db = openDb(":memory:");
  const id = startRun(db, RUN);
  const r = readRun(db, id)!;
  expect([r.momusVersion, r.baselineId, r.allowAdded, r.allowRemoved, r.ci]).toEqual([undefined, undefined, false, false, {}]);
  expect(readRun(db, id + 1)).toBeNull();
});

test("failScore round-trips on a comparison", () => {
  const db = openDb(":memory:");
  const id = startRun(db, RUN);
  saveComparison(db, id, { path: "/", viewport: 1, devUrl: "d", prodUrl: "p", status: "ok", diffScore: 0.2, failScore: 0.05, passed: false });
  saveComparison(db, id, { path: "/e", viewport: 1, devUrl: "d", prodUrl: "p", status: "error", error: "x" });
  const rows = readComparisons(db, id);
  expect(rows.find((r) => r.path === "/")!.failScore).toBe(0.05);
  expect(rows.find((r) => r.path === "/e")!.failScore).toBeUndefined();
});

test("pruneRuns keeps the newest N runs and their comparisons", () => {
  const db = openDb(":memory:");
  const ids = [1, 2, 3, 4].map(() => {
    const id = startRun(db, RUN);
    saveComparison(db, id, { path: "/", viewport: 1, devUrl: "d", prodUrl: "p", status: "ok", devImage: new Uint8Array(10) });
    return id;
  });
  expect(pruneRuns(db, 2)).toBe(2);
  expect(listRunIds(db)).toEqual(ids.slice(2));
  const n = (db.query("SELECT COUNT(*) AS n FROM comparisons").get() as { n: number }).n;
  expect(n).toBe(2);
});

test("pruneRuns with keep 0 keeps everything", () => {
  const db = openDb(":memory:");
  startRun(db, RUN); startRun(db, RUN);
  expect(pruneRuns(db, 0)).toBe(0);
  expect(listRunIds(db).length).toBe(2);
});

test("pruneRuns reclaims space in the file", () => {
  dir = mkdtempSync(join(import.meta.dir, ".tmp-prune-"));
  const db = openDb(join(dir, "p.sqlite"));
  for (let i = 0; i < 3; i++) {
    const id = startRun(db, RUN);
    saveComparison(db, id, { path: "/", viewport: 1, devUrl: "d", prodUrl: "p", status: "ok", devImage: new Uint8Array(500_000) });
  }
  pruneRuns(db, 1);
  expect((db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count).toBe(0);
});

test("each writeSnapshot gets a new id; only one snapshot row exists", () => {
  const db = openDb(":memory:");
  const a = writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}" });
  const b = writeSnapshot(db, { createdAt: "b", prodBaseUrl: "https://two.com", viewports: [2], stabilize: STAB, configJson: "{}" });
  expect(b).toBeGreaterThan(a);
  expect(readSnapshot(db)!.id).toBe(b);
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://two.com");
  expect((db.query("SELECT COUNT(*) AS n FROM snapshot").get() as { n: number }).n).toBe(1);
});

test("comparison identity round-trips; omitted identity defaults to a page", () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "t" });
  saveComparison(db, runId, { path: "/a", viewport: 1280, devUrl: "d", prodUrl: "p", status: "ok" });
  saveComparison(db, runId, {
    targetId: "scenarios:nav", source: "scenarios", label: "Nav open",
    path: "/", viewport: 1280, devUrl: "d", prodUrl: "p", status: "added",
  });
  const rows = readComparisons(db, runId);
  const page = rows.find((r) => r.path === "/a")!;
  expect([page.targetId, page.source, page.label]).toEqual(["/a", "pages", "/a"]);
  const sc = rows.find((r) => r.targetId === "scenarios:nav")!;
  expect([sc.source, sc.label, sc.status]).toEqual(["scenarios", "Nav open", "added"]);
});

test("two targets sharing a path are distinct comparison rows", () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "t" });
  saveComparison(db, runId, { path: "/", viewport: 1280, devUrl: "d", prodUrl: "p", status: "ok" });
  saveComparison(db, runId, { targetId: "scenarios:nav", source: "scenarios", label: "Nav", path: "/", viewport: 1280, devUrl: "d", prodUrl: "p", status: "ok" });
  expect(readComparisons(db, runId).length).toBe(2);
});

test("baseline identity and recipe round-trip; omitted identity defaults to a page", () => {
  const db = openDb(":memory:");
  saveBaselineImage(db, { path: "/", viewport: 1280, prodUrl: "u", status: "ok" });
  saveBaselineImage(db, {
    targetId: "scenarios:nav", source: "scenarios", label: "Nav", recipeJson: '{"a":1}',
    path: "/", viewport: 1280, prodUrl: "u", status: "ok",
  });
  const [page, sc] = readBaselineImages(db) as [BaselineImageRow, BaselineImageRow]; // ordered by target_id: "/" < "scenarios:nav"
  expect([page.targetId, page.source, page.label, page.recipeJson]).toEqual(["/", "pages", "/", null]);
  expect([sc.targetId, sc.source, sc.label, sc.recipeJson]).toEqual(["scenarios:nav", "scenarios", "Nav", '{"a":1}']);
});
