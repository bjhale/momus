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
  migrate(db);
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
