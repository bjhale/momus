// src/store/migrations.ts
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

/** One schema step. `up` runs inside a transaction together with the
 * user_version bump, so a failed step leaves the DB at the previous version.
 * A step is frozen once released: later changes are new steps, never edits,
 * because a user's DB may have stopped at any version. `vacuum` asks for a
 * VACUUM after commit (it can't run inside a transaction), for steps that
 * rebuild BLOB-bearing tables and would otherwise leave the old pages behind
 * in the committed file. */
export interface Migration {
  version: number;
  up: (db: Database) => void;
  vacuum?: boolean;
}

export class DbTooNewError extends Error {
  constructor(path: string, found: number, latest: number) {
    super(`${path} was written by a newer momus (schema version ${found}; this momus reads up to ${latest}). ` +
      `Upgrade momus, or point output.db at a different file.`);
    this.name = "DbTooNewError";
  }
}

export function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

// --- v1: the v0.9.x schema, verbatim. On a pre-versioning DB every statement
// is a no-op except the browser column, which v0.8 and earlier lacked; that
// is what "detected by its tables and assigned version 1" means in practice.
const V1_SCHEMA = `
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
);`;

function v1(db: Database): void {
  db.exec(V1_SCHEMA);
  if (!hasColumn(db, "snapshot", "browser")) db.exec("ALTER TABLE snapshot ADD COLUMN browser TEXT;");
}

// --- v2: key both image tables on target_id (RFC-0001, ADR-0021).
const V2_COMPARISONS = `
CREATE TABLE comparisons (
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
const V2_COMPARISONS_INDEX = `CREATE INDEX idx_comparisons_score ON comparisons(run_id, diff_score DESC);`;
const V2_BASELINE_IMAGES = `
CREATE TABLE baseline_images (
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

/** SQLite can't alter a UNIQUE constraint, so each table is rebuilt with
 * target_id = label = path and source = 'pages': exactly the ids a pages-only
 * config produces, so an existing baseline stays diffable. Each half is
 * skipped when already done, because DBs written by pre-release RFC-0001
 * builds carry target_id at user_version 0. */
function v2(db: Database): void {
  if (!hasColumn(db, "baseline_images", "target_id")) {
    db.exec("ALTER TABLE baseline_images RENAME TO baseline_images_pre_targets;");
    db.exec(V2_BASELINE_IMAGES);
    db.exec(`INSERT INTO baseline_images
      (target_id, source, label, path, viewport, prod_url, recipe_json, image, status, error)
      SELECT path, 'pages', path, path, viewport, prod_url, NULL, image, status, error
      FROM baseline_images_pre_targets;`);
    db.exec("DROP TABLE baseline_images_pre_targets;");
  }
  if (!hasColumn(db, "comparisons", "target_id")) {
    db.exec("ALTER TABLE comparisons RENAME TO comparisons_pre_targets;");
    // The index moved with the renamed table; drop it so the new table gets its own.
    db.exec("DROP INDEX IF EXISTS idx_comparisons_score;");
    db.exec(V2_COMPARISONS);
    db.exec(`INSERT INTO comparisons
      (id, run_id, target_id, source, label, path, viewport, dev_url, prod_url, dev_image, prod_image,
       diff_image, width, height, diff_pixels, diff_score, passed, status, error)
      SELECT id, run_id, path, 'pages', path, path, viewport, dev_url, prod_url, dev_image, prod_image,
       diff_image, width, height, diff_pixels, diff_score, passed, status, error
      FROM comparisons_pre_targets;`);
    db.exec("DROP TABLE comparisons_pre_targets;");
    db.exec(V2_COMPARISONS_INDEX);
  }
}

// --- v3: run history (RFC-0002, ADR-0025). AUTOINCREMENT so a pruned id is
// never handed out again: `report --run 3` and an approval's source run
// (RFC-0003) must always mean the same run. SQLite can't add AUTOINCREMENT to
// an existing table, so runs and snapshot are rebuilt (no BLOBs; cheap). The
// build-new / drop-old / rename-new order matters: renaming the OLD table
// would rewrite comparisons' REFERENCES runs(id) to point at it.
function v3(db: Database): void {
  db.exec(`CREATE TABLE runs_v3 (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    dev_base_url   TEXT NOT NULL,
    prod_base_url  TEXT NOT NULL,
    config_json    TEXT NOT NULL,
    status         TEXT NOT NULL,
    momus_version  TEXT,
    engine         TEXT,
    engine_version TEXT,
    config_hash    TEXT,
    baseline_id    INTEGER,
    baseline_json  TEXT,
    allow_added    INTEGER,
    allow_removed  INTEGER,
    ci_commit      TEXT,
    ci_branch      TEXT,
    ci_pr          TEXT
  );`);
  db.exec(`INSERT INTO runs_v3 (id, started_at, finished_at, dev_base_url, prod_base_url, config_json, status)
    SELECT id, started_at, finished_at, dev_base_url, prod_base_url, config_json, status FROM runs;`);
  // RFC-0001-era builds ran with allowAdded/allowRemoved but stored them only
  // inside config_json. json_extract yields 1/0 for true/false and NULL when
  // absent; json_valid guards rows whose config_json isn't JSON at all.
  db.exec(`UPDATE runs_v3 SET
    allow_added   = CASE WHEN json_valid(config_json) THEN json_extract(config_json, '$.diff.allowAdded') END,
    allow_removed = CASE WHEN json_valid(config_json) THEN json_extract(config_json, '$.diff.allowRemoved') END;`);
  db.exec("DROP TABLE runs;");
  db.exec("ALTER TABLE runs_v3 RENAME TO runs;");

  db.exec(`CREATE TABLE snapshot_v3 (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL,
    prod_base_url  TEXT NOT NULL,
    viewports_json TEXT NOT NULL,
    stabilize_json TEXT NOT NULL,
    config_json    TEXT NOT NULL,
    browser        TEXT
  );`);
  db.exec(`INSERT INTO snapshot_v3 SELECT id, created_at, prod_base_url, viewports_json, stabilize_json, config_json, browser FROM snapshot;`);
  db.exec("DROP TABLE snapshot;");
  db.exec("ALTER TABLE snapshot_v3 RENAME TO snapshot;");

  // The failScore that applied, per comparison: a re-rendered old run must
  // reach the verdict it reached then, without today's config.
  db.exec("ALTER TABLE comparisons ADD COLUMN fail_score REAL;");
}

// --- v4: the prod setup's identity on the baseline (RFC-0004, ADR-0030).
// NULL means "no setup", which every earlier baseline had, so they stay
// diffable against a config without setup (ADR-0010).
function v4(db: Database): void {
  db.exec("ALTER TABLE snapshot ADD COLUMN setup_json TEXT;");
}

// --- v5: capture determinism and diff quality (RFC-0006). Columns only.
// NULL rendering reads as "host": nothing was pinned before (ADR-0033).
// The comparison columns are NULL on older rows, which render as before.
function v5(db: Database): void {
  db.exec("ALTER TABLE snapshot ADD COLUMN rendering TEXT;");
  db.exec("ALTER TABLE baseline_images ADD COLUMN unstable_regions_json TEXT;");
  for (const col of ["dev_width", "dev_height", "prod_width", "prod_height", "region_count", "retries"]) {
    db.exec(`ALTER TABLE comparisons ADD COLUMN ${col} INTEGER;`);
  }
  db.exec("ALTER TABLE comparisons ADD COLUMN regions_json TEXT;");
  db.exec("ALTER TABLE comparisons ADD COLUMN unstable_regions_json TEXT;");
}

// --- v6: the browser engine version the baseline was captured with
// (RFC-0009, ADR-0038). NULL on older baselines, which the gate doesn't
// compare: their version is unknowable, and refusing them would force every
// existing user to re-capture on upgrade.
function v6(db: Database): void {
  db.exec("ALTER TABLE snapshot ADD COLUMN engine_version TEXT;");
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, up: v1 },
  { version: 2, up: v2, vacuum: true },
  { version: 3, up: v3, vacuum: true },
  { version: 4, up: v4 },
  { version: 5, up: v5 },
  { version: 6, up: v6 },
];

export const LATEST_VERSION = MIGRATIONS.length;

/** Bring `db` up to the last version in `migrations`, one transaction per step. */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): void {
  const latest = migrations.at(-1)?.version ?? 0;
  const current = userVersion(db);
  if (current > latest) throw new DbTooNewError(db.filename, current, latest);
  let vacuum = false;
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version};`);
    })();
    vacuum ||= m.vacuum === true;
  }
  // The .sqlite is the committed artifact: reclaim rebuilt tables' old pages
  // rather than ship the images twice.
  if (vacuum) {
    // Pruning runs relies on incremental_vacuum, which needs this mode.
    db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
    db.exec("VACUUM;");
  }
}

/** Refuse a newer DB before anything can write to it: even switching on WAL
 * rewrites the header, so the check uses a read-only handle. */
export function assertNotTooNew(path: string, latest: number = LATEST_VERSION): void {
  if (path === ":memory:" || !existsSync(path)) return;
  const probe = new Database(path, { readonly: true });
  try {
    const found = userVersion(probe);
    if (found > latest) throw new DbTooNewError(path, found, latest);
  } finally {
    probe.close();
  }
}
