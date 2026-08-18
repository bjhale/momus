# ADR-0002: Images as SQLite BLOBs in a single-run DB

**Date:** 2026-07-03 · **Status:** Accepted

## Context

A run produces three PNGs per `path × viewport` (dev, prod, diff). The obvious
approach is a directory tree of image files plus an index. That means managing
paths, cleanup between runs, partial-state directories after a crash, and a
multi-file artifact to move around.

## Decision

Store every image as a **BLOB in SQLite**. No filesystem layout, no image
directory. The DB is single-run: `runs` holds one row (`id = 1`) and is
overwritten each run.

Shape the schema so that history is addable later without a rewrite — `runs` is a
real table keyed by `id`, not a bare key/value blob, and `comparisons.run_id`
references it.

## Consequences

- One `.sqlite` file is the entire artifact. It can be committed, uploaded as a
  CI artifact, or shipped to someone else, and it later became the natural home
  for the prod baseline too ([ADR-0009](0009-baseline-in-same-db.md)).
- Opened in WAL mode; **all writes happen on the main thread**, respecting
  SQLite's single-writer model (see
  [ADR-0005](0005-split-concurrency-model.md)).
- Committing per comparison means a mid-run crash leaves a readable partial DB
  rather than nothing.
- DB size grows with `pages × viewports × 3` full-page PNGs. Gzipping the BLOBs
  is a known lever, deliberately deferred (PNG is already compressed).
- Run history, trend analysis, and multiple baselines side by side stay out of
  scope. One DB, one baseline, one run.
