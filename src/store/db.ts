// src/store/db.ts
import { Database } from "bun:sqlite";
import type { ComparisonRecord } from "../types";
import type { StabilizeOptions } from "../capture/screenshot";
import type { BrowserEngine } from "../capture/browser";
import type { TargetSourceName } from "../targets/target";
import { assertNotTooNew, migrate } from "./migrations";

/** Open (creating if absent) and migrate to the current schema. A DB written
 * by a newer momus throws DbTooNewError before any write. */
export function openDb(path: string): Database {
  assertNotTooNew(path);
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // Effective only before the first table exists; migrate() converts older files.
  db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
  migrate(db);
  return db;
}

export interface CiMetadata { commit?: string; branch?: string; pr?: string }

export interface StartRunArgs {
  devBaseUrl: string; prodBaseUrl: string; configJson: string; startedAt: string;
  momusVersion?: string; engine?: string; engineVersion?: string; configHash?: string;
  /** The baseline this run diffs against: its id and identity (RFC-0002 server checklist). */
  baselineId?: number; baselineJson?: string;
  /** The gate that applied to added/removed rows. */
  allowAdded?: boolean; allowRemoved?: boolean;
  ci?: CiMetadata;
}

const boolOrNull = (b: boolean | undefined) => (b === undefined ? null : b ? 1 : 0);

export function startRun(db: Database, a: StartRunArgs): number {
  const res = db.query(
    `INSERT INTO runs (started_at, dev_base_url, prod_base_url, config_json, status,
       momus_version, engine, engine_version, config_hash, baseline_id, baseline_json,
       allow_added, allow_removed, ci_commit, ci_branch, ci_pr)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.startedAt, a.devBaseUrl, a.prodBaseUrl, a.configJson,
    a.momusVersion ?? null, a.engine ?? null, a.engineVersion ?? null, a.configHash ?? null,
    a.baselineId ?? null, a.baselineJson ?? null,
    boolOrNull(a.allowAdded), boolOrNull(a.allowRemoved),
    a.ci?.commit ?? null, a.ci?.branch ?? null, a.ci?.pr ?? null,
  );
  return Number(res.lastInsertRowid);
}

export interface RunRow {
  id: number; startedAt: string; finishedAt?: string; status: string;
  devBaseUrl: string; prodBaseUrl: string; configJson: string;
  momusVersion?: string; engine?: string; engineVersion?: string; configHash?: string;
  baselineId?: number; baselineJson?: string;
  /** NULL on a pre-v3 run reads as false: those runs predate added/removed. */
  allowAdded: boolean; allowRemoved: boolean;
  ci: CiMetadata;
}

export function readRun(db: Database, id: number): RunRow | null {
  const x = db.query("SELECT * FROM runs WHERE id = ?").get(id) as any;
  if (!x) return null;
  const ci: CiMetadata = {};
  if (x.ci_commit !== null) ci.commit = x.ci_commit;
  if (x.ci_branch !== null) ci.branch = x.ci_branch;
  if (x.ci_pr !== null) ci.pr = x.ci_pr;
  return {
    id: x.id, startedAt: x.started_at, finishedAt: x.finished_at ?? undefined, status: x.status,
    devBaseUrl: x.dev_base_url, prodBaseUrl: x.prod_base_url, configJson: x.config_json,
    momusVersion: x.momus_version ?? undefined, engine: x.engine ?? undefined,
    engineVersion: x.engine_version ?? undefined, configHash: x.config_hash ?? undefined,
    baselineId: x.baseline_id ?? undefined, baselineJson: x.baseline_json ?? undefined,
    allowAdded: x.allow_added === 1, allowRemoved: x.allow_removed === 1,
    ci,
  };
}

export function latestRunId(db: Database): number | null {
  return (db.query("SELECT max(id) AS id FROM runs").get() as { id: number | null }).id;
}

export function listRunIds(db: Database): number[] {
  return (db.query("SELECT id FROM runs ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
}

/** Keep the newest `keep` runs (0 = all). Each run owns its images outright
 * (no sharing, no dedupe: ADR-0025), so pruning is a plain delete. The freed
 * pages go back to the OS via incremental_vacuum, since the file is often
 * committed. Returns how many runs were deleted. */
export function pruneRuns(db: Database, keep: number): number {
  if (keep <= 0) return 0;
  const kept = `SELECT id FROM runs ORDER BY id DESC LIMIT ${Math.floor(keep)}`;
  const deleted = db.transaction(() => {
    db.exec(`DELETE FROM comparisons WHERE run_id NOT IN (${kept})`);
    return db.query(`DELETE FROM runs WHERE id NOT IN (${kept})`).run().changes;
  })();
  if (deleted > 0) db.exec("PRAGMA incremental_vacuum;");
  return deleted;
}

export function saveComparison(db: Database, runId: number, r: ComparisonRecord): void {
  db.query(
    `INSERT OR REPLACE INTO comparisons
     (run_id, target_id, source, label, path, viewport, dev_url, prod_url, dev_image, prod_image, diff_image,
      width, height, diff_pixels, diff_score, fail_score, passed, status, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId, r.targetId ?? r.path, r.source ?? "pages", r.label ?? r.path,
    r.path, r.viewport, r.devUrl, r.prodUrl,
    r.devImage ?? null, r.prodImage ?? null, r.diffImage ?? null,
    r.width ?? null, r.height ?? null, r.diffPixels ?? null, r.diffScore ?? null, r.failScore ?? null,
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
    diffPixels: x.diff_pixels ?? undefined, diffScore: x.diff_score ?? undefined, failScore: x.fail_score ?? undefined,
    passed: x.passed === null ? undefined : x.passed === 1,
    status: x.status, error: x.error ?? undefined,
  }));
}

export interface SnapshotMeta {
  /** Never reused, so a run's baseline_id names exactly one baseline. Absent
   * on a meta that hasn't been written yet. */
  id?: number;
  createdAt: string;
  prodBaseUrl: string;
  viewports: number[];
  stabilize: StabilizeOptions;
  configJson: string;
  browser?: BrowserEngine;
}

export function writeSnapshot(db: Database, m: SnapshotMeta): number {
  db.exec("DELETE FROM snapshot;");
  const res = db.query(
    `INSERT INTO snapshot (created_at, prod_base_url, viewports_json, stabilize_json, config_json, browser)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(m.createdAt, m.prodBaseUrl, JSON.stringify(m.viewports), JSON.stringify(m.stabilize), m.configJson, m.browser ?? "chromium");
  return Number(res.lastInsertRowid);
}

export function readSnapshot(db: Database): SnapshotMeta | null {
  const row = db.query("SELECT * FROM snapshot ORDER BY id DESC LIMIT 1").get() as any;
  if (!row) return null;
  return {
    id: row.id,
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

