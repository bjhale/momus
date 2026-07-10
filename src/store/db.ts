// src/store/db.ts
import { Database } from "bun:sqlite";
import type { ComparisonRecord } from "../types";
import type { StabilizeOptions } from "../capture/screenshot";
import type { BrowserEngine } from "../capture/browser";

// DDL inlined as a string constant (NOT read from a .sql file at runtime) so it
// is embedded in the `bun build --compile` binary. See the note above Step 1.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  dev_base_url  TEXT NOT NULL,
  prod_base_url TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comparisons (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  path          TEXT NOT NULL,
  viewport      INTEGER NOT NULL,
  dev_url       TEXT NOT NULL,
  prod_url      TEXT NOT NULL,
  dev_image     BLOB,
  prod_image    BLOB,
  diff_image    BLOB,
  width         INTEGER,
  height        INTEGER,
  diff_pixels   INTEGER,
  diff_score    REAL,
  passed        INTEGER,
  status        TEXT NOT NULL,
  error         TEXT,
  UNIQUE(run_id, path, viewport)
);

CREATE INDEX IF NOT EXISTS idx_comparisons_score ON comparisons(run_id, diff_score DESC);

CREATE TABLE IF NOT EXISTS snapshot (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,
  stabilize_json TEXT NOT NULL,
  config_json    TEXT NOT NULL,
  browser        TEXT
);

CREATE TABLE IF NOT EXISTS baseline_images (
  path      TEXT NOT NULL,
  viewport  INTEGER NOT NULL,
  prod_url  TEXT NOT NULL,
  image     BLOB,
  status    TEXT NOT NULL,
  error     TEXT,
  UNIQUE(path, viewport)
);
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // Migrate older DBs: add the snapshot.browser column if it is missing.
  const cols = db.query("PRAGMA table_info(snapshot)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "browser")) {
    db.exec("ALTER TABLE snapshot ADD COLUMN browser TEXT;");
  }
  return db;
}

export interface StartRunArgs {
  devBaseUrl: string; prodBaseUrl: string; configJson: string; startedAt: string;
}

export function startRun(db: Database, a: StartRunArgs): number {
  // Single-run mode: clear any prior run first.
  db.exec("DELETE FROM comparisons; DELETE FROM runs;");
  db.query(
    `INSERT INTO runs (id, started_at, dev_base_url, prod_base_url, config_json, status)
     VALUES (1, ?, ?, ?, ?, 'running')`,
  ).run(a.startedAt, a.devBaseUrl, a.prodBaseUrl, a.configJson);
  return 1;
}

export function saveComparison(db: Database, runId: number, r: ComparisonRecord): void {
  db.query(
    `INSERT OR REPLACE INTO comparisons
     (run_id, path, viewport, dev_url, prod_url, dev_image, prod_image, diff_image,
      width, height, diff_pixels, diff_score, passed, status, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId, r.path, r.viewport, r.devUrl, r.prodUrl,
    r.devImage ?? null, r.prodImage ?? null, r.diffImage ?? null,
    r.width ?? null, r.height ?? null, r.diffPixels ?? null, r.diffScore ?? null,
    r.passed === undefined ? null : (r.passed ? 1 : 0), r.status, r.error ?? null,
  );
}

export function finishRun(db: Database, runId: number, status: string, finishedAt: string): void {
  db.query(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`).run(status, finishedAt, runId);
}

export interface ComparisonRow extends ComparisonRecord { id: number }

export function readComparisons(db: Database, runId: number): ComparisonRow[] {
  const rows = db.query(
    `SELECT * FROM comparisons WHERE run_id = ? ORDER BY diff_score DESC`,
  ).all(runId) as any[];
  return rows.map((x) => ({
    id: x.id, path: x.path, viewport: x.viewport, devUrl: x.dev_url, prodUrl: x.prod_url,
    devImage: x.dev_image ? new Uint8Array(x.dev_image) : undefined,
    prodImage: x.prod_image ? new Uint8Array(x.prod_image) : undefined,
    diffImage: x.diff_image ? new Uint8Array(x.diff_image) : undefined,
    width: x.width ?? undefined, height: x.height ?? undefined,
    diffPixels: x.diff_pixels ?? undefined, diffScore: x.diff_score ?? undefined,
    passed: x.passed === null ? undefined : x.passed === 1,
    status: x.status, error: x.error ?? undefined,
  }));
}

export interface SnapshotMeta {
  createdAt: string;
  prodBaseUrl: string;
  viewports: number[];
  stabilize: StabilizeOptions;
  configJson: string;
  browser?: BrowserEngine;
}

export function writeSnapshot(db: Database, m: SnapshotMeta): void {
  db.exec("DELETE FROM snapshot;");
  db.query(
    `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json, browser)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(m.createdAt, m.prodBaseUrl, JSON.stringify(m.viewports), JSON.stringify(m.stabilize), m.configJson, m.browser ?? "chromium");
}

export function readSnapshot(db: Database): SnapshotMeta | null {
  const row = db.query("SELECT * FROM snapshot WHERE id = 1").get() as any;
  if (!row) return null;
  return {
    createdAt: row.created_at,
    prodBaseUrl: row.prod_base_url,
    viewports: JSON.parse(row.viewports_json),
    stabilize: JSON.parse(row.stabilize_json),
    configJson: row.config_json,
    browser: (row.browser ?? "chromium") as BrowserEngine,
  };
}

export interface BaselineImageRow {
  path: string;
  viewport: number;
  prodUrl: string;
  image?: Uint8Array;
  status: "ok" | "error";
  error?: string;
}

export function saveBaselineImage(db: Database, r: BaselineImageRow): void {
  db.query(
    `INSERT OR REPLACE INTO baseline_images (path, viewport, prod_url, image, status, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(r.path, r.viewport, r.prodUrl, r.image ?? null, r.status, r.error ?? null);
}

export function readBaselineImages(db: Database): BaselineImageRow[] {
  const rows = db.query("SELECT * FROM baseline_images ORDER BY path, viewport").all() as any[];
  return rows.map((x) => ({
    path: x.path,
    viewport: x.viewport,
    prodUrl: x.prod_url,
    image: x.image ? new Uint8Array(x.image) : undefined,
    status: x.status,
    error: x.error ?? undefined,
  }));
}

export function clearBaseline(db: Database): void {
  db.exec("DELETE FROM baseline_images; DELETE FROM snapshot;");
}

export function clearRuns(db: Database): void {
  db.exec("DELETE FROM comparisons; DELETE FROM runs;");
}
