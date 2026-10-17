# ADR-0025: Run history

**Date:** 2026-10-17 · **Status:** Accepted · **Supersedes:** the single-run half of [ADR-0002](0002-sqlite-blobs-single-run-db.md)

## Context

[ADR-0002](0002-sqlite-blobs-single-run-db.md) made the DB single-run: `runs`
held one row and every `run` overwrote it. Approval (RFC-0003) approves
captures *from a run*, and the server (RFC-0010) ingests runs, so both need
past runs to exist and to describe themselves without the config file. Images
as BLOBs in one SQLite file still stands.

## Decision

`run` inserts a new run and never truncates (schema v3,
[ADR-0024](0024-versioned-schema-migrations.md)).

- **Ids are never reused.** `runs.id` and `snapshot.id` are `AUTOINCREMENT`, so
  `momus report --run 3` and an approval's source run always name the same run,
  even after pruning.
- **A run's images belong to it alone.** No content-hash dedupe, decided
  2026-10-17. A run's evidence never changes after it's written, and pruning is
  a plain delete with no reference counting.
- **Retention:** `output.keepRuns`, default 5 (decided 2026-10-17), 0 for
  unlimited. After each run the oldest runs and their comparisons are deleted,
  then `PRAGMA incremental_vacuum` returns the pages; the file is
  `auto_vacuum = INCREMENTAL`. The default is small because the file is often
  committed, and 5 still leaves approval a few runs to choose from.
- **`momus snapshot` no longer clears runs.** Each run stores its own prod
  images plus `baseline_id` and the baseline's identity JSON, so a new baseline
  doesn't invalidate it.
- **Provenance on every run:** momus version (from `package.json`, see
  `src/version.ts`), engine and engine version, a sha256 of the resolved config
  with sorted keys, baseline id + identity, the `allowAdded`/`allowRemoved` gate,
  and CI commit/branch/PR from `--commit`/`--branch`/`--pr`. Each comparison
  stores the `fail_score` that applied. Together these answer RFC-0002's
  server-ready checklist from the schema alone.
- **`momus report [--run ID]`** re-renders the latest or a named run with the
  gate stored on that run, not today's config. It only reads `output.db`: a
  missing file, an empty DB or an unknown id exits 2 without creating anything.

Rejected: default `keepRuns` to 1 (the old behavior) and make history opt-in.
Approval would then need users to change a setting before it could work, and a
single run gives nothing to choose between.

## Consequences

- The file grows to roughly `keepRuns` runs' worth of dev, prod and diff PNGs
  plus the baseline. Users who commit it can lower `keepRuns`.
- Detecting CI metadata from environment variables is left to RFC-0008, which
  fills the same columns.
- Pre-v3 runs have NULL provenance; their gate reads as strict (allow flags
  false), which is what applied before added/removed existed.
- The release workflow refuses a tag that doesn't match `package.json`'s
  version, since every run is stamped with it.
