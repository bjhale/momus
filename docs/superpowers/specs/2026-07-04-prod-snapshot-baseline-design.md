# Design: Decoupled prod snapshots (reusable baselines)

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan

## Problem

Today `momus run` couples three things into one invocation: discover-from-prod,
capture **both** prod and dev, then diff. Every dev iteration re-screenshots
prod. Users want to capture prod **once** into a reusable artifact and diff many
dev builds against it without re-hitting prod.

Motivations (all three apply):

- **Speed of iteration** — prod capture is slow; dev is tweaked repeatedly.
- **Frozen baseline** — pin a known-good prod state so dev is always diffed
  against a fixed point even as prod drifts.
- **CI / cost** — snapshot prod once (e.g. nightly), compare many PR/dev builds
  against it.

Because all three matter, the snapshot must be a **portable, self-contained
artifact** that can be committed or uploaded/downloaded as a CI artifact.

## Core correctness constraint

A prod snapshot is only diff-able against dev when dev is captured at the **same
viewports** and with the **same stabilization/masking** settings, over the
**same set of paths**. A dev capture at 1280px against a prod capture at 768px is
~100% "changed" — a meaningless diff. Therefore the snapshot must carry that
capture context, and the dev run must be prevented from producing an invalid
diff.

**Decision:** live config governs the dev run, but momus **hard-errors if the
baseline's `viewports` or `stabilize` differ** from the live config. The
discovered **path set** necessarily comes from the snapshot, since a baseline run
deliberately does not re-hit prod to re-discover.

## 1. Workflow & CLI

Two new capabilities, fully backward compatible.

```bash
# Capture prod once -> a self-contained baseline file
momus snapshot --config momus.config.ts --out prod-baseline.sqlite

# Diff any number of dev builds against that frozen baseline (no prod hit)
momus run --baseline prod-baseline.sqlite
momus run --baseline prod-baseline.sqlite --dev https://dev-pr-123...

# Unchanged: coupled one-shot still captures both live
momus run
```

- **`momus snapshot`** — discover-from-prod + capture-prod, writes a baseline
  `.sqlite`. Accepts the discovery-relevant flags today's `run` has: `--prod`,
  `--crawl`, `--config`, `--concurrency`. `--out` sets the baseline path
  (default `momus-baseline.sqlite`).
- **`momus run --baseline FILE`** — captures **dev only**, diffs each page
  against the stored prod image, writes the normal `momus-report.html` +
  `momus.sqlite`. Path set and viewports come from the baseline. Discovery does
  **not** run. `--dev`, `--out`, `--concurrency`, `--config` still apply.
- **`momus run`** (no `--baseline`) — exactly today's behavior (capture both
  live, discover from prod).

## 2. Baseline file format

New dedicated SQLite schema in a new module `src/store/baseline.ts`. A purpose-
built schema (rather than reusing the `comparisons` table) so intent is explicit
and there are no half-null rows.

```sql
CREATE TABLE snapshot (          -- single row, id = 1
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,  -- e.g. [375,768,1280]  -> conflict check
  stabilize_json TEXT NOT NULL,  -- {waitUntil,settleMs,timeoutMs,disableAnimations,mask} -> conflict check
  config_json    TEXT NOT NULL   -- full resolved config, for provenance
);

CREATE TABLE baseline_images (
  path      TEXT NOT NULL,
  viewport  INTEGER NOT NULL,
  prod_url  TEXT NOT NULL,
  image     BLOB,                -- null when prod capture failed
  status    TEXT NOT NULL,       -- 'ok' | 'error'
  error     TEXT,
  UNIQUE(path, viewport)
);
```

Self-contained, one file — commit it or pass it as a CI artifact.

`src/store/baseline.ts` exposes (names indicative):

- `openBaselineDb(path)` — create/open, set WAL, apply schema.
- `writeSnapshotMeta(db, { createdAt, prodBaseUrl, viewports, stabilize, configJson })`.
- `saveBaselineImage(db, { path, viewport, prodUrl, image?, status, error? })`.
- `readSnapshotMeta(db)` -> `{ createdAt, prodBaseUrl, viewports, stabilize, configJson }`.
- `readBaselineImages(db)` -> rows including decoded `Uint8Array` images.

## 3. Snapshot pipeline (`src/commands/snapshot.ts`)

Structure mirrors today's run, but one-sided and writing the baseline store:

1. Guard: browser installed; load + resolve config (with `--prod`/`--crawl`/
   `--concurrency` overrides).
2. Fresh baseline DB at `--out` (remove stale file + `-wal`/`-shm` sidecars,
   as `run` does today).
3. Discover paths from prod (`discoverPaths`, same wiring as `run`, honoring
   `--crawl`).
4. Fan out path x viewport; `capture(browser, prodUrl, viewport, stabilize)`
   under `mapWithConcurrency(config.concurrency.screenshots)`.
5. Write each result into `baseline_images` (image on success, `error` row on
   failure). Write `snapshot` meta (created_at, prod url, viewports, stabilize,
   full config json).
6. Teardown browser in `finally`.

Reuses existing `launchBrowser`, `capture`, `discoverPaths`,
`mapWithConcurrency`.

**Exit codes:** `0` snapshot written (individual prod-page failures are stored
as error rows, not fatal); `2` operational failure (missing browser, bad config,
discovery threw).

## 4. Baseline-run pipeline + conflict check

`run --baseline FILE`:

1. Open baseline read-only; read `snapshot` meta. Missing/unreadable baseline ->
   exit `2` with a clear message.
2. **Conflict check** — deep-equal live `config.viewports` vs `viewports_json`
   **and** live `config.stabilize` vs `stabilize_json`. On mismatch: hard-error,
   exit `2`, message naming which field differs. (`dev` URL, `concurrency`,
   `diff.*` thresholds, `output.*` come from live config — legitimately
   run-specific, not checked.)
3. Jobs = `baseline_images` rows.
   - `ok` row: capture dev at `(path, viewport)`, diff against the stored prod
     `image`, gate against `failScore`/overrides, save a normal comparison.
   - `error` row (prod capture previously failed): record an error comparison
     carrying the prod-side message (consistent with today's one-sided-failure
     handling).
4. Write `momus-report.html` + `momus.sqlite`, exit code as today.

## 5. Shared pipeline seam (refactor `src/pipeline/run.ts`)

Generalize the single place prod is acquired so both modes share the diff/gate/
save core. `runPipeline` gains two injected seams in place of the current
`discover` + `captureFn` pair:

- `listJobs(): Promise<Job[]>` — jobs from discovery x viewports (one-shot) or
  from the baseline rows (baseline mode). `Job = { path, viewport, devUrl, prodUrl }`.
- `getProd(job): Promise<CaptureResult>` — capture live (one-shot) or return the
  stored blob wrapped as a `CaptureResult` (baseline mode).
- `getDev(job): Promise<CaptureResult>` — the existing dev-side `captureFn`.

The `diff -> gate -> saveComparison` inner logic (and the per-job error guard) is
untouched and shared. The two run modes become thin wiring differences over one
core. One-shot mode wires `getProd` to a live capture and `listJobs` to
`discover x viewports`; baseline mode wires `getProd` to the store and
`listJobs` to the baseline rows.

## 6. Error handling & exit codes

Semantics unchanged from today.

| Command | Code | Meaning |
| --- | --- | --- |
| `snapshot` | 0 | Baseline written (per-page prod failures stored as error rows). |
| `snapshot` | 2 | Operational failure (no browser, bad config, discovery threw). |
| `run --baseline` | 0 | All pages captured and passed. |
| `run --baseline` | 1 | Any page failed the gate or errored. |
| `run --baseline` | 2 | Operational failure, incl. baseline-config conflict or unreadable/absent baseline. |

## 7. Testing

- **`baseline.ts` store**: round-trip `snapshot` meta + `baseline_images`
  (ok + error rows); image BLOB decodes back to bytes.
- **Conflict check**: matching viewports+stabilize passes; differing `viewports`
  errors; differing `stabilize.mask` errors — each exit `2`.
- **`snapshot` command**: discovers, captures (injected fake capture fn), writes
  both tables; a prod capture failure becomes an `error` row, run still exits 0.
- **`run --baseline`**: dev captured only (prod NOT re-captured — assert prod
  capture fn is never called), prod image pulled from baseline, diff/gate/save
  correct; a prod `error` baseline row yields an error comparison; missing
  baseline file -> exit 2.
- **Backward-compat**: plain `run` (no `--baseline`) still captures both sides
  and behaves as today.

## Out of scope

- Multi-run history / retaining several baselines side by side (single baseline
  file per invocation; run history remains out of scope per README).
- Report annotations for baseline provenance (could later surface
  `snapshot.created_at` in the report header — not required here).
