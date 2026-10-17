// src/store/db.ts
import { Database } from "bun:sqlite";
import type { ComparisonRecord } from "../types";
import type { StabilizeOptions } from "../capture/screenshot";
import type { BrowserEngine } from "../capture/browser";
import type { TargetSourceName } from "../targets/target";

// Image tables are keyed on (target_id, viewport): RFC-0001. Kept as named
// constants because the pre-targets migration rebuilds both tables from them.
const COMPARISONS_DDL = `
CREATE TABLE IF NOT EXISTS comparisons (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  target_id     TEXT NOT NULL,
  source        TEXT NOT NULL,
  label         TEXT NOT NULL,
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
  UNIQUE(run_id, target_id, viewport)
);`;

const COMPARISONS_INDEX = `CREATE INDEX IF NOT EXISTS idx_comparisons_score ON comparisons(run_id, diff_score DESC);`;

const BASELINE_IMAGES_DDL = `
CREATE TABLE IF NOT EXISTS baseline_images (
  target_id   TEXT NOT NULL,
  source      TEXT NOT NULL,
  label       TEXT NOT NULL,
  path        TEXT NOT NULL,
  viewport    INTEGER NOT NULL,
  prod_url    TEXT NOT NULL,
  recipe_json TEXT,
  image       BLOB,
  status      TEXT NOT NULL,
  error       TEXT,
  UNIQUE(target_id, viewport)
);`;

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
${COMPARISONS_DDL}
${COMPARISONS_INDEX}

CREATE TABLE IF NOT EXISTS snapshot (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,
  stabilize_json TEXT NOT NULL,
  config_json    TEXT NOT NULL,
  browser        TEXT
);
${BASELINE_IMAGES_DDL}
`;

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/** Pre-RFC-0001 DBs key both image tables on `path`. SQLite can't alter a
 * UNIQUE constraint, so each table is rebuilt with target_id = label = path and
 * source = 'pages'. Those are exactly the ids a pages-only config produces now,
 * so an existing baseline stays diffable. One transaction: a failed rebuild
 * leaves the old tables untouched. */
function migrateToTargets(db: Database): void {
  const baselineDone = hasColumn(db, "baseline_images", "target_id");
  const comparisonsDone = hasColumn(db, "comparisons", "target_id");
  if (baselineDone && comparisonsDone) return;
  db.transaction(() => {
    if (!baselineDone) {
      db.exec("ALTER TABLE baseline_images RENAME TO baseline_images_pre_targets;");
      db.exec(BASELINE_IMAGES_DDL);
      db.exec(`INSERT INTO baseline_images
        (target_id, source, label, path, viewport, prod_url, recipe_json, image, status, error)
        SELECT path, 'pages', path, path, viewport, prod_url, NULL, image, status, error
        FROM baseline_images_pre_targets;`);
      db.exec("DROP TABLE baseline_images_pre_targets;");
    }
    if (!comparisonsDone) {
      db.exec("ALTER TABLE comparisons RENAME TO comparisons_pre_targets;");
      // The index moved with the renamed table; drop it so the new table gets its own.
      db.exec("DROP INDEX IF EXISTS idx_comparisons_score;");
      db.exec(COMPARISONS_DDL);
      db.exec(`INSERT INTO comparisons
        (id, run_id, target_id, source, label, path, viewport, dev_url, prod_url, dev_image, prod_image,
         diff_image, width, height, diff_pixels, diff_score, passed, status, error)
        SELECT id, run_id, path, 'pages', path, path, viewport, dev_url, prod_url, dev_image, prod_image,
         diff_image, width, height, diff_pixels, diff_score, passed, status, error
        FROM comparisons_pre_targets;`);
      db.exec("DROP TABLE comparisons_pre_targets;");
      db.exec(COMPARISONS_INDEX);
    }
  })();
}

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // Migrate older DBs: add the snapshot.browser column if it is missing.
  if (!hasColumn(db, "snapshot", "browser")) {
    db.exec("ALTER TABLE snapshot ADD COLUMN browser TEXT;");
  }
  migrateToTargets(db);
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
     (run_id, target_id, source, label, path, viewport, dev_url, prod_url, dev_image, prod_image, diff_image,
      width, height, diff_pixels, diff_score, passed, status, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId, r.targetId ?? r.path, r.source ?? "pages", r.label ?? r.path,
    r.path, r.viewport, r.devUrl, r.prodUrl,
    r.devImage ?? null, r.prodImage ?? null, r.diffImage ?? null,
    r.width ?? null, r.height ?? null, r.diffPixels ?? null, r.diffScore ?? null,
    r.passed === undefined ? null : (r.passed ? 1 : 0), r.status, r.error ?? null,
  );
}

export function finishRun(db: Database, runId: number, status: string, finishedAt: string): void {
  db.query(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`).run(status, finishedAt, runId);
}

export interface ComparisonRow extends ComparisonRecord {
  id: number; targetId: string; source: TargetSourceName; label: string;
}

export function readComparisons(db: Database, runId: number): ComparisonRow[] {
  const rows = db.query(
    `SELECT * FROM comparisons WHERE run_id = ? ORDER BY diff_score DESC`,
  ).all(runId) as any[];
  return rows.map((x) => ({
    id: x.id, targetId: x.target_id, source: x.source as TargetSourceName, label: x.label,
    path: x.path, viewport: x.viewport, devUrl: x.dev_url, prodUrl: x.prod_url,
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
  targetId: string;
  source: TargetSourceName;
  label: string;
  path: string;
  viewport: number;
  prodUrl: string;
  /** canonicalJson of the target's recipe at capture time; null = no recipe. */
  recipeJson: string | null;
  image?: Uint8Array;
  status: "ok" | "error";
  error?: string;
}

type Identity = "targetId" | "source" | "label" | "recipeJson";
/** Identity is optional on write and defaults to the page form, so callers that
 * only know a path (and pre-targets tests) keep working. */
export type BaselineImageInput = Omit<BaselineImageRow, Identity> & Partial<Pick<BaselineImageRow, Identity>>;

export function saveBaselineImage(db: Database, r: BaselineImageInput): void {
  db.query(
    `INSERT OR REPLACE INTO baseline_images
     (target_id, source, label, path, viewport, prod_url, recipe_json, image, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.targetId ?? r.path, r.source ?? "pages", r.label ?? r.path, r.path, r.viewport, r.prodUrl,
    r.recipeJson ?? null, r.image ?? null, r.status, r.error ?? null,
  );
}

export function readBaselineImages(db: Database): BaselineImageRow[] {
  const rows = db.query("SELECT * FROM baseline_images ORDER BY target_id, viewport").all() as any[];
  return rows.map((x) => ({
    targetId: x.target_id,
    source: x.source as TargetSourceName,
    label: x.label,
    path: x.path,
    viewport: x.viewport,
    prodUrl: x.prod_url,
    recipeJson: x.recipe_json ?? null,
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
