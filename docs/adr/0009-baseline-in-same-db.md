# ADR-0009: The prod baseline lives in the same SQLite file

**Date:** 2026-07-04 · **Status:** Accepted

## Context

Originally every `momus run` re-screenshotted prod. Three separate motivations
argued for capturing prod once and reusing it: dev iteration speed (prod capture
is the slow half), pinning a known-good prod state so dev is diffed against a
fixed point even as prod drifts, and CI cost (snapshot nightly, compare many PR
builds against it).

Because all three matter, the baseline has to be a **portable artifact** —
something you can commit or pass between CI jobs. The question was where it
lives: a separate baseline file selected by a `--baseline` flag, or inside the
existing DB.

## Decision

Put it in the same `output.db`, in its own two tables:

- `snapshot` — one row: `created_at`, `prod_base_url`, `viewports_json`,
  `stabilize_json`, `browser`, full `config_json`.
- `baseline_images` — one row per `path × viewport`: the frozen prod PNG BLOB
  plus `status`/`error`.

No separate file, no `--baseline` flag. `momus snapshot` writes and replaces
them. Both are created with `CREATE TABLE IF NOT EXISTS`, so an older DB gains
them on next open.

## Decision: dedicated tables, not reused `comparisons`

A baseline row is not a comparison — it has no dev side, no diff, no verdict.
Reusing `comparisons` would mean rows that are half null and a `status` column
meaning two different things.

## Consequences

- There is exactly one file to move around, and it already had a portable-
  artifact story ([ADR-0002](0002-sqlite-blobs-single-run-db.md)).
- `run` truncates only `runs`/`comparisons` and preserves the baseline tables; it
  no longer deletes the DB file. `snapshot` clears the baseline **and** the stale
  run rows, since a new baseline invalidates prior results.
- One DB holds one baseline. Multiple baselines side by side would need a
  different key structure and stay out of scope — the intended shape is one DB
  per site, configured via `output.db`.
- Storing the full `config_json` gives provenance for free: the report header
  reports the baseline's true prod origin rather than whatever `config.prod`
  currently says.
