// src/store/db.ts
import { Database } from "bun:sqlite";
import type { ComparisonRecord } from "../types";

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
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
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
