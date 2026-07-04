# Prod Snapshot Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let momus capture prod once into a reusable baseline stored inside `momus.sqlite`, then diff many dev builds against it without re-screenshotting prod.

**Architecture:** Add two tables (`snapshot`, `baseline_images`) to the existing SQLite DB. A new `momus snapshot` command discovers + captures prod and writes those tables. `momus run` auto-detects a baseline: present → capture dev only and diff against the stored prod images; absent → today's coupled one-shot. The diff/gate/save core is shared by generalizing `runPipeline` from a single `captureFn` into `getDev`/`getProd`/`listJobs` seams.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Playwright (playwright-core), pixelmatch, Zod. Tests via `bun test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test` (`import { test, expect } from "bun:test"`).
- SQLite DDL lives **inlined as a string constant** in `src/store/db.ts` (embedded in the compiled binary — do not read `.sql` at runtime).
- `capture()` and the pipeline **never throw for one bad page**; failures are recorded as `status: "error"` comparison/baseline rows.
- CLI flags win over config-file values; config is validated with Zod (`ConfigSchema.parse`).
- Baseline reuse is only valid when dev capture matches the baseline's **viewports** and **stabilize** settings — `run` hard-errors (exit 2) otherwise.
- The single `config.output.db` file (default `momus.sqlite`) is the portable artifact; `run` must **preserve** the baseline tables and truncate only `runs`/`comparisons`.
- Commit after each task with a `feat:`/`refactor:`/`docs:` message.

---

## File Structure

- `src/store/db.ts` — **modify**: add `snapshot` + `baseline_images` DDL and helpers (`writeSnapshot`, `readSnapshot`, `saveBaselineImage`, `readBaselineImages`, `clearBaseline`, `clearRuns`, plus `SnapshotMeta`/`BaselineImageRow` types).
- `src/pipeline/run.ts` — **modify**: replace `discover`/`captureFn` with `listJobs`/`getDev`/`getProd` seams; export `Job`.
- `src/pipeline/snapshot.ts` — **create**: `snapshotPipeline` (discover → capture prod → write baseline tables), with injectable `discover`/`captureFn`.
- `src/pipeline/compat.ts` — **create**: pure `baselineConflict(config, snapshot)` viewport/stabilize check.
- `src/commands/snapshot.ts` — **create**: `snapshotCommand` — wires real browser/discovery to `snapshotPipeline`.
- `src/commands/run.ts` — **modify**: stop deleting the DB file; auto-detect baseline vs one-shot; wire both modes to `runPipeline`.
- `src/cli.ts` — **modify**: add `snapshot` command to parse + dispatch + help.
- Tests: `tests/store/db.test.ts`, `tests/pipeline/run.test.ts`, `tests/pipeline/snapshot.test.ts` (new), `tests/pipeline/compat.test.ts` (new), `tests/pipeline/baseline-roundtrip.test.ts` (new), `tests/cli.test.ts`, `tests/e2e/pipeline.integration.test.ts`, `tests/e2e/baseline.integration.test.ts` (new).

---

## Task 1: Baseline store tables & helpers (`db.ts`)

**Files:**
- Modify: `src/store/db.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Consumes: existing `openDb`, `StabilizeOptions` (type) from `src/capture/screenshot.ts`.
- Produces:
  - `interface SnapshotMeta { createdAt: string; prodBaseUrl: string; viewports: number[]; stabilize: StabilizeOptions; configJson: string }`
  - `interface BaselineImageRow { path: string; viewport: number; prodUrl: string; image?: Uint8Array; status: "ok" | "error"; error?: string }`
  - `writeSnapshot(db: Database, m: SnapshotMeta): void`
  - `readSnapshot(db: Database): SnapshotMeta | null`
  - `saveBaselineImage(db: Database, r: BaselineImageRow): void`
  - `readBaselineImages(db: Database): BaselineImageRow[]`
  - `clearBaseline(db: Database): void`
  - `clearRuns(db: Database): void`

- [ ] **Step 1: Write the failing tests**

Append to `tests/store/db.test.ts`:

```typescript
import {
  writeSnapshot, readSnapshot, saveBaselineImage, readBaselineImages,
  clearBaseline, clearRuns,
} from "../../src/store/db";

const STAB = {
  waitUntil: "networkidle" as const, settleMs: 500, timeoutMs: 15000,
  disableAnimations: true, mask: [".ad"],
};

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/store/db.test.ts`
Expected: FAIL — `writeSnapshot`/`readSnapshot`/etc. are not exported (import error or "not a function").

- [ ] **Step 3: Add the DDL and helpers**

In `src/store/db.ts`, add a type-only import at the top (after the existing imports):

```typescript
import type { StabilizeOptions } from "../capture/screenshot";
```

Extend the `SCHEMA` constant — add these two `CREATE TABLE` blocks inside the template string, before the closing backtick (after the `idx_comparisons_score` index):

```sql
CREATE TABLE IF NOT EXISTS snapshot (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,
  stabilize_json TEXT NOT NULL,
  config_json    TEXT NOT NULL
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
```

Append these exports at the end of `src/store/db.ts`:

```typescript
export interface SnapshotMeta {
  createdAt: string;
  prodBaseUrl: string;
  viewports: number[];
  stabilize: StabilizeOptions;
  configJson: string;
}

export function writeSnapshot(db: Database, m: SnapshotMeta): void {
  db.exec("DELETE FROM snapshot;");
  db.query(
    `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(m.createdAt, m.prodBaseUrl, JSON.stringify(m.viewports), JSON.stringify(m.stabilize), m.configJson);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/store/db.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts tests/store/db.test.ts
git commit -m "feat: add snapshot + baseline_images store helpers"
```

---

## Task 2: Generalize `runPipeline` to getDev/getProd/listJobs seams

**Files:**
- Modify: `src/pipeline/run.ts`
- Modify: `src/commands/run.ts` (one-shot wiring only — baseline mode comes in Task 5)
- Test: `tests/pipeline/run.test.ts` (rewrite), `tests/e2e/pipeline.integration.test.ts` (update the one call site)

**Interfaces:**
- Produces:
  - `interface Job { path: string; viewport: number; devUrl: string; prodUrl: string }`
  - `runPipeline(args)` where `args` now has `listJobs: () => Promise<Job[]>`, `getDev: (job: Job) => Promise<CaptureResult>`, `getProd: (job: Job) => Promise<CaptureResult>` (replacing `discover` and `captureFn`), plus unchanged `config`, `db`, `startedAt`, `finishedAt?`, `diffPool`.
- Consumes: `startRun`, `saveComparison`, `finishRun`, `mapWithConcurrency`, `resolveFailScore`, `passed`, `CaptureResult`.

- [ ] **Step 1: Rewrite the pipeline unit test to the new seams**

Replace the entire contents of `tests/pipeline/run.test.ts` with:

```typescript
// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { openDb, readComparisons } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";

function png(w: number, h: number, v: number): Uint8Array {
  const p = new PNG({ width: w, height: h }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

const okDiff = (a: Uint8Array): DiffResponse =>
  ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });

function runStatus(db: ReturnType<typeof openDb>): string {
  const row = db.query("SELECT status FROM runs WHERE id = 1").get() as { status: string } | null;
  return row!.status;
}

// Build path×viewport jobs the way both run modes do.
function jobs(paths: string[], viewports: number[]): Job[] {
  return paths.flatMap((path) => viewports.map((viewport) => ({
    path, viewport,
    devUrl: `https://dev.example.com${path}`,
    prodUrl: `https://www.example.com${path}`,
  })));
}

const okPng = async () => ({ ok: true as const, png: png(4, 4, 100) });

test("pipeline captures, diffs, and persists for each path×viewport", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
    listJobs: async () => jobs(["/", "/pricing"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.status).toBe("ok");
  expect(runStatus(db)).toBe("complete");
});

test("capture-error branch records status=error with dev: prefix", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: async () => ({ ok: false, error: "boom" }),
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("dev: boom");
  expect(runStatus(db)).toBe("complete");
});

test("prod-error branch records status=error with prod: prefix", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng,
    getProd: async () => ({ ok: false, error: "gone" }),
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: gone");
});

test("diff-error branch records status=error mentioning the diff failure", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (): Promise<DiffResponse> => ({ id: 1, ok: false, error: "diff boom" }), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("diff boom");
});

test("multi-viewport fan-out produces path×viewport rows", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/", "/pricing"], [375, 1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  expect(readComparisons(db, 1).length).toBe(4);
});

test("passes each side's url and the diff threshold through", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], diff: { threshold: 0.42 } });
  const db = openDb(":memory:");

  const devUrls: string[] = [];
  const prodUrls: string[] = [];
  const thresholds: number[] = [];

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/pricing"], [1280]),
    getDev: async (job) => { devUrls.push(job.devUrl); return { ok: true, png: png(4, 4, 100) }; },
    getProd: async (job) => { prodUrls.push(job.prodUrl); return { ok: true, png: png(4, 4, 100) }; },
    diffPool: {
      submit: async (a: Uint8Array, _b: Uint8Array, threshold: number) => { thresholds.push(threshold); return okDiff(a); },
      close: async () => {},
    },
  });

  expect(devUrls).toContain("https://dev.example.com/pricing");
  expect(prodUrls).toContain("https://www.example.com/pricing");
  expect(thresholds).toEqual([0.42]);
});

test("a thrown getDev for one job does not abort the run", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/boom", "/ok"], [1280]),
    getDev: async (job) => { if (job.path === "/boom") throw new Error("kaboom"); return { ok: true, png: png(4, 4, 100) }; },
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  expect(rows.find((r) => r.path === "/boom")!.status).toBe("error");
  expect(rows.find((r) => r.path === "/boom")!.error).toContain("kaboom");
  expect(rows.find((r) => r.path === "/ok")!.status).toBe("ok");
  expect(runStatus(db)).toBe("complete");
});

test("listJobs throwing marks the run failed and propagates", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await expect(runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => { throw new Error("no pages discovered"); },
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  })).rejects.toThrow("no pages discovered");

  expect(runStatus(db)).toBe("failed");
});
```

- [ ] **Step 2: Run the pipeline test to verify it fails**

Run: `bun test tests/pipeline/run.test.ts`
Expected: FAIL — `runPipeline` still expects `discover`/`captureFn`; `Job` is not exported.

- [ ] **Step 3: Rewrite `src/pipeline/run.ts` to the new seams**

Replace the file contents of `src/pipeline/run.ts` with:

```typescript
// src/pipeline/run.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult, ComparisonRecord } from "../types";
import type { DiffResponse } from "../diff/worker";
import { startRun, saveComparison, finishRun } from "../store/db";
import { mapWithConcurrency } from "./queue";
import { resolveFailScore, passed } from "./verdict";

export interface DiffPoolLike {
  submit(a: Uint8Array, b: Uint8Array, threshold: number): Promise<DiffResponse>;
  close(): Promise<void>;
}

/** One unit of comparison work: a path at a viewport, with both side URLs resolved. */
export interface Job {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
}

export interface RunPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  startedAt: string;
  finishedAt?: string;
  /** The comparison jobs to run (one-shot: discovery×viewports; baseline: stored rows). */
  listJobs: () => Promise<Job[]>;
  /** Obtain the dev-side image for a job (always a live capture). */
  getDev: (job: Job) => Promise<CaptureResult>;
  /** Obtain the prod-side image for a job (live capture, or read from the baseline store). */
  getProd: (job: Job) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
}

export async function runPipeline(args: RunPipelineArgs): Promise<void> {
  const { config, db } = args;
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: config.prod,
    configJson: JSON.stringify(config), startedAt: args.startedAt,
  });

  try {
    const jobs = await args.listJobs();

    await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
      const rec: ComparisonRecord = {
        path: job.path, viewport: job.viewport, devUrl: job.devUrl, prodUrl: job.prodUrl, status: "ok",
      };
      // Per-job guard: an unexpected throw from a seam must be recorded as an
      // error comparison, never propagated — one bad page must not abort the run.
      try {
        const [dev, prod] = await Promise.all([args.getDev(job), args.getProd(job)]);

        if (!dev.ok || !prod.ok) {
          rec.status = "error";
          rec.error = [dev.ok ? null : `dev: ${dev.error}`, prod.ok ? null : `prod: ${prod.error}`]
            .filter(Boolean).join("; ");
          saveComparison(db, runId, rec);
          return;
        }

        rec.devImage = dev.png; rec.prodImage = prod.png;
        const diff = await args.diffPool.submit(dev.png!, prod.png!, config.diff.threshold);
        if (!diff.ok) {
          rec.status = "error"; rec.error = `diff: ${diff.error}`;
          saveComparison(db, runId, rec);
          return;
        }
        rec.diffImage = diff.diffPng; rec.width = diff.width; rec.height = diff.height;
        rec.diffPixels = diff.diffPixels; rec.diffScore = diff.diffScore;
        const failScore = resolveFailScore(job.path, config.diff.failScore, config.diff.overrides);
        rec.passed = passed(diff.diffScore!, failScore);
        saveComparison(db, runId, rec);
      } catch (err) {
        rec.status = "error";
        rec.error = err instanceof Error ? err.message : String(err);
        saveComparison(db, runId, rec);
      }
    });
  } catch (err) {
    // listJobs() or the fan-out failed unexpectedly: record a terminal status so
    // the run row is never orphaned at "running", then re-throw for the CLI.
    finishRun(db, runId, "failed", args.finishedAt ?? new Date().toISOString());
    throw err;
  }

  // diffPool.close() is intentionally NOT called here — the CLI caller owns the
  // pool lifecycle, symmetric with owning listJobs/getDev/getProd.
  finishRun(db, runId, "complete", args.finishedAt ?? new Date().toISOString());
}
```

- [ ] **Step 4: Update the one-shot wiring in `src/commands/run.ts`**

In `src/commands/run.ts`, add `Job` to the pipeline import:

```typescript
import { runPipeline, type Job } from "../pipeline/run";
```

Replace the `await runPipeline({ ... })` call (the block passing `discover` and `captureFn`) with:

```typescript
    await runPipeline({
      config, db, startedAt: new Date().toISOString(),
      listJobs: async (): Promise<Job[]> => {
        const paths = await discoverPaths({
          base: config.prod,
          // `--crawl` forces a link crawl even when prod has a sitemap: disable
          // sitemap discovery for this run so the crawl path is taken.
          sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
          crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                   maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
          include: config.discovery.include, exclude: config.discovery.exclude,
          fetcher: realFetch,
        });
        return paths.flatMap((path) => config.viewports.map((viewport) => ({
          path, viewport,
          devUrl: new URL(path, config.dev).toString(),
          prodUrl: new URL(path, config.prod).toString(),
        })));
      },
      getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
      getProd: (job: Job) => capture(browser, job.prodUrl, job.viewport, config.stabilize),
      diffPool,
    });
```

- [ ] **Step 5: Update the e2e integration test call site**

In `tests/e2e/pipeline.integration.test.ts`, replace the `runPipeline({ ... })` call's `discover`/`captureFn` lines with the seam form:

```typescript
    await runPipeline({
      config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
      listJobs: async () => ["/", "/about"].flatMap((path) => [1280].map((viewport) => ({
        path, viewport,
        devUrl: `http://localhost:${dev.port}${path}`,
        prodUrl: `http://localhost:${prod.port}${path}`,
      }))),
      getDev: (job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
      getProd: (job) => capture(browser, job.prodUrl, job.viewport, config.stabilize),
      diffPool: pool,
    });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/pipeline/run.test.ts`
Expected: PASS.

Run: `bun test`
Expected: PASS (e2e browser tests run if Chromium is installed, else skipped; nothing else regresses).

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/run.ts src/commands/run.ts tests/pipeline/run.test.ts tests/e2e/pipeline.integration.test.ts
git commit -m "refactor: generalize runPipeline into getDev/getProd/listJobs seams"
```

---

## Task 3: Baseline compatibility check (`compat.ts`)

**Files:**
- Create: `src/pipeline/compat.ts`
- Test: `tests/pipeline/compat.test.ts`

**Interfaces:**
- Consumes: `ResolvedConfig` (from `../config/schema`), `SnapshotMeta` (from `../store/db`).
- Produces: `baselineConflict(config: ResolvedConfig, snapshot: SnapshotMeta): string | null` — returns a human-readable reason string when the live config's viewports or stabilize settings differ from the baseline's, else `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/pipeline/compat.test.ts`:

```typescript
// tests/pipeline/compat.test.ts
import { test, expect } from "bun:test";
import { baselineConflict } from "../../src/pipeline/compat";
import { ConfigSchema } from "../../src/config/schema";
import type { SnapshotMeta } from "../../src/store/db";

function cfg(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280], ...over });
}

function snapFrom(c: ReturnType<typeof cfg>): SnapshotMeta {
  return { createdAt: "t", prodBaseUrl: c.prod, viewports: c.viewports, stabilize: c.stabilize, configJson: "{}" };
}

test("matching viewports + stabilize → no conflict", () => {
  const c = cfg();
  expect(baselineConflict(c, snapFrom(c))).toBeNull();
});

test("differing viewports → conflict mentioning viewports", () => {
  const c = cfg({ viewports: [768] });
  const snap = snapFrom(cfg({ viewports: [375, 1280] }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("viewport");
});

test("differing stabilize.mask → conflict mentioning stabilize", () => {
  const c = cfg({ stabilize: { mask: [".new"] } });
  const snap = snapFrom(cfg({ stabilize: { mask: [".old"] } }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("stabilize");
});

test("differing stabilize.settleMs → conflict", () => {
  const c = cfg({ stabilize: { settleMs: 100 } });
  const snap = snapFrom(cfg({ stabilize: { settleMs: 999 } }));
  expect(baselineConflict(c, snap)).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/pipeline/compat.test.ts`
Expected: FAIL — `baselineConflict` is not defined.

- [ ] **Step 3: Implement `src/pipeline/compat.ts`**

```typescript
// src/pipeline/compat.ts
import type { ResolvedConfig } from "../config/schema";
import type { SnapshotMeta } from "../store/db";

/** A prod baseline is only diff-able against dev when dev is captured with the
 * same viewports and stabilize settings. Returns a reason string on mismatch,
 * or null when the live config is compatible with the baseline. Compared
 * field-by-field so SQLite/JSON key ordering can never cause a false mismatch. */
export function baselineConflict(config: ResolvedConfig, snapshot: SnapshotMeta): string | null {
  const cv = config.viewports, sv = snapshot.viewports;
  if (cv.length !== sv.length || cv.some((v, i) => v !== sv[i])) {
    return `viewports differ: config ${JSON.stringify(cv)} vs baseline ${JSON.stringify(sv)}`;
  }

  const cs = config.stabilize, ss = snapshot.stabilize;
  if (
    cs.waitUntil !== ss.waitUntil ||
    cs.settleMs !== ss.settleMs ||
    cs.timeoutMs !== ss.timeoutMs ||
    cs.disableAnimations !== ss.disableAnimations ||
    cs.mask.length !== ss.mask.length ||
    cs.mask.some((m, i) => m !== ss.mask[i])
  ) {
    return `stabilize settings differ from the baseline; re-snapshot or align momus.config.ts`;
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/pipeline/compat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/compat.ts tests/pipeline/compat.test.ts
git commit -m "feat: add baseline viewport/stabilize compatibility check"
```

---

## Task 4: Snapshot pipeline + command + CLI wiring

**Files:**
- Create: `src/pipeline/snapshot.ts`
- Create: `src/commands/snapshot.ts`
- Modify: `src/cli.ts`
- Test: `tests/pipeline/snapshot.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Produces:
  - `snapshotPipeline(args: { config: ResolvedConfig; db: Database; createdAt: string; discover: () => Promise<string[]>; captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult> }): Promise<void>` — discovers prod paths, captures each path×viewport, writes `baseline_images` + the `snapshot` row. Clears the prior baseline + stale runs **after** a successful discovery.
  - `snapshotCommand(parsed: ParsedCli): Promise<number>` — CLI entry; returns exit code (0 ok, 2 operational).
  - `parseCliArgs` recognizes `"snapshot"` as a command.
- Consumes: `clearBaseline`, `clearRuns`, `saveBaselineImage`, `writeSnapshot` (Task 1); `discoverPaths`; `capture`; `launchBrowser`, `isBrowserInstalled`; `mapWithConcurrency`.

- [ ] **Step 1: Write the failing snapshot-pipeline test**

Create `tests/pipeline/snapshot.test.ts`:

```typescript
// tests/pipeline/snapshot.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { openDb, readSnapshot, readBaselineImages } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

test("snapshotPipeline captures prod and writes baseline tables", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "2026-07-04T00:00:00Z",
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(100) }),
  });

  const rows = readBaselineImages(db);
  expect(rows.length).toBe(4); // 2 paths × 2 viewports
  for (const r of rows) { expect(r.status).toBe("ok"); expect(r.image).toBeInstanceOf(Uint8Array); }

  const snap = readSnapshot(db)!;
  expect(snap.prodBaseUrl).toBe("https://www.example.com");
  expect(snap.viewports).toEqual([375, 1280]);
  expect(rows.some((r) => r.prodUrl === "https://www.example.com/pricing")).toBe(true);
});

test("a failed prod capture is stored as an error row, snapshot still written", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/broken"],
    captureFn: async (url) => url.includes("/broken") ? { ok: false, error: "404" } : { ok: true, png: png(100) },
  });

  const rows = readBaselineImages(db);
  const broken = rows.find((r) => r.path === "/broken")!;
  expect(broken.status).toBe("error");
  expect(broken.error).toContain("404");
  expect(broken.image).toBeUndefined();
  expect(readSnapshot(db)).not.toBeNull();
});

test("discovery failure leaves any prior baseline intact and propagates", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  // Seed a prior baseline.
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  expect(readBaselineImages(db).length).toBe(1);

  // A re-snapshot whose discovery throws must NOT wipe the existing baseline.
  await expect(snapshotPipeline({
    config, db, createdAt: "t2",
    discover: async () => { throw new Error("no pages discovered"); },
    captureFn: async () => ({ ok: true, png: png(50) }),
  })).rejects.toThrow("no pages discovered");

  expect(readBaselineImages(db).length).toBe(1); // old baseline preserved
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/pipeline/snapshot.test.ts`
Expected: FAIL — `snapshotPipeline` is not defined.

- [ ] **Step 3: Implement `src/pipeline/snapshot.ts`**

```typescript
// src/pipeline/snapshot.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import { clearBaseline, clearRuns, saveBaselineImage, writeSnapshot } from "../store/db";
import { mapWithConcurrency } from "./queue";

export interface SnapshotPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  createdAt: string;
  discover: () => Promise<string[]>;
  captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
}

/** Capture prod once into the baseline tables. Discovery runs FIRST so a
 * discovery failure never wipes a previously good baseline. */
export async function snapshotPipeline(args: SnapshotPipelineArgs): Promise<void> {
  const { config, db } = args;

  const paths = await args.discover();

  // Discovery succeeded — safe to replace the old baseline and invalidate any
  // prior dev-run results (they were diffed against the now-replaced baseline).
  clearBaseline(db);
  clearRuns(db);

  const jobs = paths.flatMap((path) => config.viewports.map((viewport) => ({
    path, viewport, prodUrl: new URL(path, config.prod).toString(),
  })));

  await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
    // capture() never throws; on failure it returns { ok:false, error }.
    const res = await args.captureFn(job.prodUrl, job.viewport, config);
    saveBaselineImage(db, {
      path: job.path, viewport: job.viewport, prodUrl: job.prodUrl,
      image: res.ok ? res.png : undefined,
      status: res.ok ? "ok" : "error",
      error: res.ok ? undefined : res.error,
    });
  });

  writeSnapshot(db, {
    createdAt: args.createdAt,
    prodBaseUrl: config.prod,
    viewports: config.viewports,
    stabilize: config.stabilize,
    configJson: JSON.stringify(config),
  });
}
```

- [ ] **Step 4: Run to verify the pipeline test passes**

Run: `bun test tests/pipeline/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the `snapshot` command**

Create `src/commands/snapshot.ts`:

```typescript
// src/commands/snapshot.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { openDb, readBaselineImages } from "../store/db";
import { snapshotPipeline } from "../pipeline/snapshot";
import type { ResolvedConfig } from "../config/schema";

export async function snapshotCommand(parsed: ParsedCli): Promise<number> {
  if (!isBrowserInstalled()) {
    console.error("No browser found. Run `momus install-browser` first.");
    return 2;
  }

  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  try {
    const raw = await loadConfigFile(configPath);
    config = resolveConfig(raw, parsed.overrides);
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  // Open (create if absent) — do NOT delete the DB file: a snapshot only
  // replaces the baseline tables, leaving the file available for later runs.
  const db = openDb(config.output.db);
  const browser = await launchBrowser();

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  try {
    await snapshotPipeline({
      config, db, createdAt: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
    });
  } catch (err) {
    console.error(`Snapshot failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await browser.close().catch(() => {});
  }

  const count = readBaselineImages(db).length;
  db.close();
  console.log(`Wrote baseline to ${config.output.db} (${count} prod captures). Exit 0.`);
  return 0;
}
```

- [ ] **Step 6: Wire the `snapshot` command into the CLI**

In `src/cli.ts`:

Change the command union type:

```typescript
  command: "run" | "snapshot" | "init" | "install-browser" | "help";
```

Add `"snapshot"` to the known set:

```typescript
  const known = new Set(["run", "snapshot", "init", "install-browser"]);
```

Add a dispatch case in `main()` (next to the `run` case):

```typescript
      case "snapshot": {
        const { snapshotCommand } = await import("./commands/snapshot");
        process.exit(await snapshotCommand(parsed));
      }
```

Update the help text default case to include snapshot:

```typescript
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus snapshot [--prod URL] [--config FILE] [--concurrency N] [--crawl]\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--crawl]`);
```

- [ ] **Step 7: Add the CLI parse test**

Append to `tests/cli.test.ts`:

```typescript
test("parses snapshot subcommand with overrides", () => {
  const p = parseCliArgs(["snapshot", "--prod", "https://p.com", "--concurrency", "4", "--crawl"]);
  expect(p.command).toBe("snapshot");
  expect(p.overrides.prod).toBe("https://p.com");
  expect(p.overrides.concurrency).toBe(4);
  expect(p.overrides.crawl).toBe(true);
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/pipeline/snapshot.test.ts tests/cli.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/snapshot.ts src/commands/snapshot.ts src/cli.ts tests/pipeline/snapshot.test.ts tests/cli.test.ts
git commit -m "feat: add momus snapshot command to capture a reusable prod baseline"
```

---

## Task 5: `run` baseline auto-detect + preserve the baseline file

**Files:**
- Modify: `src/commands/run.ts`
- Test: `tests/pipeline/baseline-roundtrip.test.ts` (new, no browser), `tests/e2e/baseline.integration.test.ts` (new, browser-guarded)

**Interfaces:**
- Consumes: `readSnapshot`, `readBaselineImages` (Task 1); `baselineConflict` (Task 3); `runPipeline`/`Job` (Task 2); `capture`.
- Produces: no new exports — `runCommand` gains baseline-mode branching and stops deleting the DB file.

- [ ] **Step 1: Write the failing no-browser roundtrip test**

This test drives the exact wiring `runCommand` uses in baseline mode (build jobs from `readBaselineImages`, `getProd` from the store, live `getDev`), proving prod is never re-captured and the baseline survives the run. Create `tests/pipeline/baseline-roundtrip.test.ts`:

```typescript
// tests/pipeline/baseline-roundtrip.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { baselineConflict } from "../../src/pipeline/compat";
import { openDb, readSnapshot, readBaselineImages, type BaselineImageRow } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { CaptureResult } from "../../src/types";
import type { DiffResponse } from "../../src/diff/worker";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}
const okDiff = (a: Uint8Array): DiffResponse => ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });

// Mirror of runCommand's baseline-mode wiring (kept in sync with src/commands/run.ts).
function baselineWiring(config: ReturnType<typeof ConfigSchema.parse>, db: ReturnType<typeof openDb>, getDev: (job: Job) => Promise<CaptureResult>) {
  const images = readBaselineImages(db);
  const byKey = new Map<string, BaselineImageRow>(images.map((im) => [`${im.path} ${im.viewport}`, im]));
  const listJobs = async (): Promise<Job[]> => images.map((im) => ({
    path: im.path, viewport: im.viewport,
    devUrl: new URL(im.path, config.dev).toString(), prodUrl: im.prodUrl,
  }));
  const getProd = async (job: Job): Promise<CaptureResult> => {
    const im = byKey.get(`${job.path} ${job.viewport}`)!;
    return im.status === "ok" && im.image ? { ok: true, png: im.image } : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
  };
  return { listJobs, getDev, getProd };
}

test("snapshot then run: prod pulled from baseline, dev captured live, baseline preserved", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({ config, db, createdAt: "t", discover: async () => ["/", "/pricing"], captureFn: async () => ({ ok: true, png: png(100) }) });

  // Conflict check passes for a matching config.
  expect(baselineConflict(config, readSnapshot(db)!)).toBeNull();

  // getProd is store-backed; getDev is the ONLY seam allowed to capture live.
  // A live prod capture would throw here, proving prod is never re-screenshotted.
  const wiring = baselineWiring(config, db, async () => ({ ok: true, png: png(150) }));

  const { readComparisons } = await import("../../src/store/db");
  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: wiring.listJobs, getDev: wiring.getDev, getProd: wiring.getProd,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.status).toBe("ok");
  // The prod side served to the diff came from the baseline BLOB (png(100)),
  // not a live capture (which would have been png(150)).
  for (const r of rows) expect(Array.from(r.prodImage!)).toEqual(Array.from(png(100)));
  for (const r of rows) expect(Array.from(r.devImage!)).toEqual(Array.from(png(150)));
  // The baseline itself is still present after the run.
  expect(readSnapshot(db)).not.toBeNull();
  expect(readBaselineImages(db).length).toBe(2);
});

test("a prod error row in the baseline yields an error comparison, dev not diffed", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/broken"],
    captureFn: async () => ({ ok: false, error: "404" }),
  });

  const wiring = baselineWiring(config, db, async () => ({ ok: true, png: png(150) }));
  const { readComparisons } = await import("../../src/store/db");
  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: wiring.listJobs, getDev: wiring.getDev, getProd: wiring.getProd,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: 404");
});
```

- [ ] **Step 2: Run to verify it fails / passes as expected**

Run: `bun test tests/pipeline/baseline-roundtrip.test.ts`
Expected: PASS — this test uses only Task 1–4 exports (it validates the wiring shape before it's embedded in `runCommand`). If it fails, fix the wiring helper to match the exports. (No production change is under test yet; the next steps embed this wiring in `runCommand`.)

- [ ] **Step 3: Stop deleting the DB file and add baseline auto-detect in `runCommand`**

In `src/commands/run.ts`, update imports:

```typescript
import { openDb, readComparisons, readSnapshot, readBaselineImages, type BaselineImageRow } from "../store/db";
import { runPipeline, type Job } from "../pipeline/run";
import { baselineConflict } from "../pipeline/compat";
```

Delete the DB-file deletion block (the `for (const suffix of ["", "-wal", "-shm"]) { ... }` loop and its comment) so the baseline tables survive across runs. Replace it with just:

```typescript
  // Preserve the DB file across runs so a prod baseline (if present) is reused.
  // runPipeline's startRun truncates only runs/comparisons.
  const db = openDb(config.output.db);
```

Then, immediately after `const diffPool = new DiffPool(config.concurrency.diffWorkers);` and the `realFetch` definition, branch on the presence of a baseline. Replace the single `try { await runPipeline({...one-shot...}) }` block with:

```typescript
  const snapshot = readSnapshot(db);

  try {
    if (snapshot) {
      // Baseline mode: diff live dev against stored prod images; do not re-hit prod.
      const conflict = baselineConflict(config, snapshot);
      if (conflict) {
        console.error(`Baseline conflict: ${conflict}`);
        return 2;
      }
      const images = readBaselineImages(db);
      const byKey = new Map<string, BaselineImageRow>(
        images.map((im) => [`${im.path} ${im.viewport}`, im]));

      await runPipeline({
        config, db, startedAt: new Date().toISOString(),
        listJobs: async (): Promise<Job[]> => images.map((im) => ({
          path: im.path, viewport: im.viewport,
          devUrl: new URL(im.path, config.dev).toString(),
          prodUrl: im.prodUrl,
        })),
        getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
        getProd: async (job: Job) => {
          const im = byKey.get(`${job.path} ${job.viewport}`)!;
          return im.status === "ok" && im.image
            ? { ok: true, png: im.image }
            : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
        },
        diffPool,
      });
    } else {
      // One-shot mode: discover + capture both sides live (unchanged behavior).
      await runPipeline({
        config, db, startedAt: new Date().toISOString(),
        listJobs: async (): Promise<Job[]> => {
          const paths = await discoverPaths({
            base: config.prod,
            sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
            crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                     maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
            include: config.discovery.include, exclude: config.discovery.exclude,
            fetcher: realFetch,
          });
          return paths.flatMap((path) => config.viewports.map((viewport) => ({
            path, viewport,
            devUrl: new URL(path, config.dev).toString(),
            prodUrl: new URL(path, config.prod).toString(),
          })));
        },
        getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
        getProd: (job: Job) => capture(browser, job.prodUrl, job.viewport, config.stabilize),
        diffPool,
      });
    }
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await diffPool.close().catch(() => {});
    await browser.close().catch(() => {});
  }
```

Note: the conflict-check `return 2` sits inside the `try`; its `finally` still closes `diffPool` and `browser`. Leave the post-block report/exit-code section (`readComparisons` → `writeReport` → `exitCodeFor`) unchanged — in baseline mode the run row and comparisons exist exactly as in one-shot mode.

- [ ] **Step 4: Write the browser-guarded end-to-end test**

Create `tests/e2e/baseline.integration.test.ts`:

```typescript
// tests/e2e/baseline.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons, readSnapshot, readBaselineImages, type BaselineImageRow } from "../../src/store/db";
import { snapshotPipeline } from "../../src/pipeline/snapshot";
import { runPipeline, type Job } from "../../src/pipeline/run";
import { ConfigSchema } from "../../src/config/schema";

const maybe = isBrowserInstalled() ? test : test.skip;

function serve(pages: Record<string, string>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const body = pages[path];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
  });
}

maybe("snapshot prod once, then run dev against it: unchanged passes, changed fails", async () => {
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });

  const config = ConfigSchema.parse({
    dev: "http://localhost:1", // overwritten per phase below via job URLs
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    // --- Phase 1: snapshot prod ---
    await snapshotPipeline({
      config, db, createdAt: "2026-07-04T00:00:00Z",
      discover: async () => ["/", "/about"],
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
    });
    expect(readSnapshot(db)).not.toBeNull();
    expect(readBaselineImages(db).length).toBe(2);

    // --- Phase 2: run dev against the baseline (dev "/about" changed) ---
    const dev = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
    });
    const images = readBaselineImages(db);
    const byKey = new Map<string, BaselineImageRow>(images.map((im) => [`${im.path} ${im.viewport}`, im]));
    try {
      await runPipeline({
        config, db, startedAt: "2026-07-04T00:01:00Z", finishedAt: "2026-07-04T00:02:00Z",
        listJobs: async (): Promise<Job[]> => images.map((im) => ({
          path: im.path, viewport: im.viewport,
          devUrl: `http://localhost:${dev.port}${im.path}`, prodUrl: im.prodUrl,
        })),
        getDev: (job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
        getProd: async (job) => {
          const im = byKey.get(`${job.path} ${job.viewport}`)!;
          return im.status === "ok" && im.image ? { ok: true, png: im.image } : { ok: false, error: im.error ?? "prod failed" };
        },
        diffPool: pool,
      });
    } finally { dev.stop(); }

    const rows = readComparisons(db, 1);
    expect(rows.find((r) => r.path === "/")!.passed).toBe(true);
    expect(rows.find((r) => r.path === "/about")!.passed).toBe(false);
    // Baseline survived the run.
    expect(readBaselineImages(db).length).toBe(2);
  } finally {
    await pool.close(); await browser.close(); prod.stop();
  }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/pipeline/baseline-roundtrip.test.ts tests/e2e/baseline.integration.test.ts`
Expected: PASS (the e2e test runs if Chromium is installed, else skipped).

Run: `bun test`
Expected: PASS across the whole suite.

- [ ] **Step 6: Manually verify the mode switch (optional but recommended)**

If Chromium is installed and you have a `momus.config.ts`, sanity-check the real commands:

```bash
bun run src/cli.ts snapshot --config momus.config.ts   # writes baseline into momus.sqlite
bun run src/cli.ts run                                  # auto-detects baseline: dev-only
sqlite3 momus.sqlite "SELECT count(*) FROM baseline_images;"  # still populated after run
```

Expected: snapshot prints `Wrote baseline to momus.sqlite (N prod captures)`, run prints `Wrote momus-report.html (N comparisons)`, and the baseline count is unchanged after the run.

- [ ] **Step 7: Commit**

```bash
git add src/commands/run.ts tests/pipeline/baseline-roundtrip.test.ts tests/e2e/baseline.integration.test.ts
git commit -m "feat: run auto-detects a prod baseline and preserves it across runs"
```

---

## Task 6: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the snapshot workflow in `README.md`**

In the "## Commands" section, add a `### momus snapshot` subsection immediately before `### momus run [flags]`:

```markdown
### `momus snapshot [flags]`

Captures the **prod** baseline once into `output.db` (default `momus.sqlite`):
discovers pages from prod, screenshots each at every viewport, and stores the
prod images plus the capture context (viewports + stabilize settings). Reuse it
across many `momus run` invocations without re-screenshotting prod.

| Flag | Description |
| --- | --- |
| `--config FILE` | Path to the config file (default `./momus.config.ts`). |
| `--prod URL` | Override the config's `prod` base URL. |
| `--concurrency N` | Override the number of concurrent screenshots. |
| `--crawl` | Force same-origin crawl discovery on. |

The baseline lives in its own tables inside `output.db`; the single SQLite file
is the portable artifact — commit it or pass it as a CI artifact.
```

Then update the `### momus run [flags]` description to explain auto-detect. Replace the sentence "Runs the full pipeline: discover → capture → diff → report." with:

```markdown
Runs the pipeline against the configured `dev` build. momus **auto-detects** a
prod baseline in `output.db`:

- **Baseline present** (written by `momus snapshot`): captures **dev only** and
  diffs each page against the stored prod images — prod is not re-screenshotted.
  The run reuses the baseline's page set and viewports, and **fails fast (exit
  2)** if the live config's `viewports` or `stabilize` settings differ from the
  baseline's. Only the `runs`/`comparisons` tables are refreshed; the baseline
  is preserved.
- **No baseline**: discovers from prod and captures **both** dev and prod live
  (the original one-shot behavior).
```

- [ ] **Step 2: Add a snapshot/run example to the Quick start**

In "## Quick start", after the existing one-shot example block, add:

```markdown
To capture prod once and compare several dev builds against it:

    # snapshot prod into momus.sqlite (do this once, or nightly in CI)
    docker run --rm -v "$PWD:/work" YOUR_DOCKERHUB_USER/momus snapshot --config momus.config.ts
    # diff any dev build against the frozen baseline (repeat as often as you like)
    docker run --rm -v "$PWD:/work" YOUR_DOCKERHUB_USER/momus run --dev https://dev-pr-123.example.com
```

- [ ] **Step 3: Update the "How it works" and known-limitations notes**

In "## How it works", add a line after step 1 (Discover):

```markdown
   With a stored baseline (`momus snapshot`), discovery and prod capture are
   skipped — the run diffs live dev against the baseline's prod images.
```

In "## Notes & known limitations", replace the "Run history is out of scope"
bullet with:

```markdown
- **One baseline per DB.** `momus snapshot` stores a single prod baseline in
  `output.db`; a new snapshot replaces it (and clears stale run results). Full
  multi-run history remains out of scope; a separate server component may add it
  later.
```

- [ ] **Step 4: Verify the docs render and commit**

Run: `bun test` (ensure nothing broke; docs change is inert)
Expected: PASS.

```bash
git add README.md
git commit -m "docs: document momus snapshot and run baseline auto-detect"
```

---

## Self-Review

**1. Spec coverage:**
- §1 CLI (snapshot cmd, run auto-detect, no `--baseline`) → Task 4 (snapshot + CLI), Task 5 (run auto-detect), Task 6 (docs). ✓
- §2 storage (tables in `db.ts`, helpers, `readSnapshot` null = no baseline) → Task 1. ✓
- §3 snapshot pipeline (discover→capture→write, clear baseline+stale runs, error rows, exit codes) → Task 4 (`snapshotPipeline` + command). Discovery-first ordering preserves prior baseline. ✓
- §4 run baseline (truncate runs only, conflict check exit 2, jobs from baseline, prod error rows) → Task 3 (conflict) + Task 5 (wiring, stop deleting file). ✓
- §5 shared seam (`listJobs`/`getProd`/`getDev`) → Task 2. ✓
- §6 exit codes → Task 4 (snapshot 0/2), Task 5 (run 0/1/2 incl. conflict). ✓
- §7 testing (store round-trip, baseline preserved, conflict, snapshot error row, run auto-detect present/absent, prod-not-recaptured, backward-compat) → Tasks 1–5 tests. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code. ✓

**3. Type consistency:** `SnapshotMeta`, `BaselineImageRow`, `Job` defined in Tasks 1/2 and consumed with matching field names (`path`, `viewport`, `prodUrl`, `image`, `status`, `error`; `devUrl`) in Tasks 3–5. `baselineConflict(config, snapshot)` signature consistent across Task 3 and Task 5. Store fn names (`writeSnapshot`/`readSnapshot`/`saveBaselineImage`/`readBaselineImages`/`clearBaseline`/`clearRuns`) identical everywhere. ✓

**Note for the implementer:** the baseline-mode wiring in `tests/pipeline/baseline-roundtrip.test.ts` mirrors the production wiring embedded in `src/commands/run.ts` (Task 5, Step 3). If you change the key format (`${path} ${viewport}`) or the prod-error message, update both.
