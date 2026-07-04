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
artifact** that can be committed or uploaded/downloaded as a CI artifact. That
artifact is the single `momus.sqlite` DB itself: the baseline lives in its own
tables inside the same DB the run uses, so there is exactly one file to move
around.

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

One new command; `run` gains an auto-detected baseline mode. Fully backward
compatible. Everything lives in one DB (`config.output.db`, default
`momus.sqlite`) — there is no separate baseline file and no `--baseline` flag.

```bash
# Capture prod once -> baseline tables inside momus.sqlite
momus snapshot --config momus.config.ts

# Diff any number of dev builds against that frozen baseline (no prod hit).
# run auto-detects the baseline in momus.sqlite.
momus run
momus run --dev https://dev-pr-123...

# No baseline in the DB yet -> unchanged coupled one-shot (capture both live)
momus run
```

- **`momus snapshot`** — discover-from-prod + capture-prod, writes/replaces the
  `snapshot` + `baseline_images` tables **inside `config.output.db`**. Accepts
  the discovery-relevant flags today's `run` has: `--prod`, `--crawl`,
  `--config`, `--concurrency`. No `--out` — it targets the config's `output.db`
  path. Because a new baseline invalidates any prior dev-run results, it also
  clears stale `runs`/`comparisons` rows.
- **`momus run`** — reads `config.output.db` and **auto-detects**:
  - **Baseline present** (`snapshot` table has a row): captures **dev only**,
    diffs each page against the stored prod image, writes the normal
    `momus-report.html`. Path set and viewports come from the baseline;
    discovery does **not** run. `--dev`, `--out`, `--concurrency`, `--config`
    still apply.
  - **No baseline**: exactly today's coupled one-shot (capture both live,
    discover from prod).

  Either way `run` truncates only the `runs`/`comparisons` tables at start and
  **preserves the baseline tables** — it no longer deletes the DB file.

## 2. Storage: one DB, baseline in its own tables

No separate baseline file. Two new tables are added to the existing schema in
`src/store/db.ts`, living in `config.output.db` (default `momus.sqlite`)
alongside `runs`/`comparisons`. `openDb` creates all four via `CREATE TABLE IF
NOT EXISTS`, so an old DB gains the baseline tables on next open. A dedicated
baseline shape (rather than reusing `comparisons`) keeps intent explicit and
avoids half-null rows.

```sql
CREATE TABLE IF NOT EXISTS snapshot (   -- single row, id = 1
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,  -- e.g. [375,768,1280]  -> conflict check
  stabilize_json TEXT NOT NULL,  -- {waitUntil,settleMs,timeoutMs,disableAnimations,mask} -> conflict check
  config_json    TEXT NOT NULL   -- full resolved config, for provenance
);

CREATE TABLE IF NOT EXISTS baseline_images (
  path      TEXT NOT NULL,
  viewport  INTEGER NOT NULL,
  prod_url  TEXT NOT NULL,
  image     BLOB,                -- null when prod capture failed
  status    TEXT NOT NULL,       -- 'ok' | 'error'
  error     TEXT,
  UNIQUE(path, viewport)
);
```

The single `momus.sqlite` is the portable artifact — commit it or pass it as a
CI artifact; a later `run` diffs against its baseline tables.

New helpers in `src/store/db.ts` (names indicative):

- `writeSnapshot(db, { createdAt, prodBaseUrl, viewports, stabilize, configJson })`
  — replaces the single `snapshot` row (delete-then-insert).
- `saveBaselineImage(db, { path, viewport, prodUrl, image?, status, error? })`.
- `readSnapshot(db)` -> `{ createdAt, prodBaseUrl, viewports, stabilize, configJson } | null`
  (null = no baseline; drives `run`'s auto-detect).
- `readBaselineImages(db)` -> rows including decoded `Uint8Array` images.
- `clearBaseline(db)` — truncate `snapshot` + `baseline_images` (used by
  `snapshot` before writing a fresh one).

## 3. Snapshot pipeline (`src/commands/snapshot.ts`)

Structure mirrors today's run, but one-sided and writing the baseline tables:

1. Guard: browser installed; load + resolve config (with `--prod`/`--crawl`/
   `--concurrency` overrides).
2. Open `config.output.db` (create if absent — do **not** delete the file).
   `clearBaseline(db)`, and clear stale `runs`/`comparisons` (a new baseline
   invalidates prior dev-run results).
3. Discover paths from prod (`discoverPaths`, same wiring as `run`, honoring
   `--crawl`).
4. Fan out path x viewport; `capture(browser, prodUrl, viewport, stabilize)`
   under `mapWithConcurrency(config.concurrency.screenshots)`.
5. Write each result via `saveBaselineImage` (image on success, `error` row on
   failure). Write the `snapshot` row via `writeSnapshot` (created_at, prod url,
   viewports, stabilize, full config json).
6. Teardown browser in `finally`.

Reuses existing `launchBrowser`, `capture`, `discoverPaths`,
`mapWithConcurrency`.

**Exit codes:** `0` snapshot written (individual prod-page failures are stored
as error rows, not fatal); `2` operational failure (missing browser, bad config,
discovery threw).

## 4. Baseline-run pipeline + conflict check

`run` in baseline mode (auto-detected: `readSnapshot(db)` returns a row):

1. Truncate `runs`/`comparisons` only (via `startRun`); baseline tables are
   preserved.
2. **Conflict check** — deep-equal live `config.viewports` vs the snapshot's
   `viewports_json` **and** live `config.stabilize` vs `stabilize_json`. On
   mismatch: hard-error, exit `2`, message naming which field differs. (`dev`
   URL, `concurrency`, `diff.*` thresholds, `output.*` come from live config —
   legitimately run-specific, not checked.)
3. Jobs = `baseline_images` rows.
   - `ok` row: capture dev at `(path, viewport)`, diff against the stored prod
     `image`, gate against `failScore`/overrides, save a normal comparison.
   - `error` row (prod capture previously failed): record an error comparison
     carrying the prod-side message (consistent with today's one-sided-failure
     handling).
4. Write `momus-report.html`, exit code as today.

When `readSnapshot(db)` returns `null`, `run` takes the one-shot path unchanged
(discover from prod, capture both).

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
| `run` (baseline mode) | 0 | All pages captured and passed. |
| `run` (baseline mode) | 1 | Any page failed the gate or errored. |
| `run` (baseline mode) | 2 | Operational failure, incl. baseline-config conflict. |
| `run` (one-shot) | 0/1/2 | Exactly as today. |

## 7. Testing

- **Store helpers (`db.ts`)**: round-trip `snapshot` row + `baseline_images`
  (ok + error rows); image BLOB decodes back to bytes; `readSnapshot` returns
  `null` on a fresh DB; `clearBaseline` empties both tables.
- **Baseline preserved across run**: after a `run`, the `snapshot` +
  `baseline_images` rows still exist (run truncated only `runs`/`comparisons`,
  did not delete the file).
- **Conflict check**: matching viewports+stabilize passes; differing `viewports`
  errors; differing `stabilize.mask` errors — each exit `2`.
- **`snapshot` command**: discovers, captures (injected fake capture fn), writes
  both baseline tables and clears stale run rows; a prod capture failure becomes
  an `error` row, exits 0.
- **`run` auto-detect**:
  - Baseline present: dev captured only (prod NOT re-captured — assert the
    prod-side capture is never called), prod image pulled from `baseline_images`,
    diff/gate/save correct; a prod `error` baseline row yields an error
    comparison.
  - No baseline: plain `run` still captures both sides and discovers from prod,
    behaving as today.

## Out of scope

- Multi-run history / retaining several baselines side by side (one baseline per
  DB; run history remains out of scope per README).
- Report annotations for baseline provenance (could later surface
  `snapshot.created_at` in the report header — not required here).
