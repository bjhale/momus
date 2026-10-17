// tests/store/migrate-targets.test.ts
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb, readBaselineImages, readComparisons, saveBaselineImage, type BaselineImageRow, type ComparisonRow } from "../../src/store/db";

// The pre-RFC-0001 shape (momus v0.9.x): both image tables keyed on path.
const OLD_SCHEMA = `
CREATE TABLE runs (id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
  dev_base_url TEXT NOT NULL, prod_base_url TEXT NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE comparisons (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES runs(id),
  path TEXT NOT NULL, viewport INTEGER NOT NULL, dev_url TEXT NOT NULL, prod_url TEXT NOT NULL,
  dev_image BLOB, prod_image BLOB, diff_image BLOB, width INTEGER, height INTEGER,
  diff_pixels INTEGER, diff_score REAL, passed INTEGER, status TEXT NOT NULL, error TEXT,
  UNIQUE(run_id, path, viewport));
CREATE INDEX idx_comparisons_score ON comparisons(run_id, diff_score DESC);
CREATE TABLE snapshot (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, prod_base_url TEXT NOT NULL,
  viewports_json TEXT NOT NULL, stabilize_json TEXT NOT NULL, config_json TEXT NOT NULL, browser TEXT);
CREATE TABLE baseline_images (path TEXT NOT NULL, viewport INTEGER NOT NULL, prod_url TEXT NOT NULL,
  image BLOB, status TEXT NOT NULL, error TEXT, UNIQUE(path, viewport));
`;

let dir = "";
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

function oldDb(): string {
  dir = mkdtempSync(join(import.meta.dir, ".tmp-migrate-"));
  const file = join(dir, "old.sqlite");
  const db = new Database(file, { create: true });
  db.exec(OLD_SCHEMA);
  db.exec(`INSERT INTO runs VALUES (1, 's', 'f', 'https://dev', 'https://prod', '{}', 'complete');`);
  db.query(`INSERT INTO comparisons (run_id, path, viewport, dev_url, prod_url, diff_score, passed, status)
            VALUES (1, '/about', 1280, 'https://dev/about', 'https://prod/about', 0.5, 0, 'ok')`).run();
  db.query(`INSERT INTO baseline_images (path, viewport, prod_url, image, status) VALUES ('/about', 1280, 'https://prod/about', ?, 'ok')`)
    .run(new Uint8Array([7, 7, 7]));
  db.close();
  return file;
}

test("a pre-targets DB migrates: page identity is backfilled from path, BLOBs kept", () => {
  const db = openDb(oldDb());
  const [b] = readBaselineImages(db) as [BaselineImageRow];
  expect([b.targetId, b.source, b.label, b.path, b.recipeJson]).toEqual(["/about", "pages", "/about", "/about", null]);
  expect(Array.from(b.image!)).toEqual([7, 7, 7]);
  const [c] = readComparisons(db, 1) as [ComparisonRow];
  expect([c.targetId, c.source, c.label, c.diffScore, c.passed]).toEqual(["/about", "pages", "/about", 0.5, false]);
});

test("after migration the unique key is (target_id, viewport)", () => {
  const db = openDb(oldDb());
  saveBaselineImage(db, { targetId: "scenarios:x", source: "scenarios", label: "x", path: "/about", viewport: 1280, prodUrl: "u", status: "ok" });
  expect(readBaselineImages(db).length).toBe(2); // same path, different target: no conflict
});

test("migration is idempotent across opens", () => {
  const file = oldDb();
  openDb(file).close();
  const db = openDb(file);
  expect(readBaselineImages(db).length).toBe(1);
  expect(readComparisons(db, 1).length).toBe(1);
});
