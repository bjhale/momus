# ADR-0027: A baseline is replaced atomically; an all-error capture doesn't freeze

**Date:** 2026-10-17 · **Status:** Accepted · **Amends:** [ADR-0011](0011-run-always-diffs-a-baseline.md)

## Context

[ADR-0011](0011-run-always-diffs-a-baseline.md) left an open question: a first
`run` while prod is unreachable froze a baseline of error rows, reused until
`momus snapshot` ran again. The options it named were to refuse to write a
snapshot (exit 2, no freeze) or to write one without freezing. Separately,
`snapshotPipeline` cleared the old baseline before capturing, so a crash
mid-capture left half a baseline, and a failed `momus snapshot` destroyed a
good one.

## Decision

Refuse to write the snapshot: exit 2, no freeze.

`snapshotPipeline` runs clear → captures → `writeSnapshot` inside one
`BEGIN IMMEDIATE` transaction on the main thread. Captures await between writes,
hence a manual `BEGIN` rather than `db.transaction()`; all writes still happen
on the main thread ([ADR-0005](0005-split-concurrency-model.md)). If every
capture failed, it rolls back and throws `ProdUnreachableError` ("prod was
unreachable … any previous baseline is unchanged"); the commands exit 2.

- This applies to `momus snapshot` and `run --snapshot`, not only a first `run`.
  In those cases the previous baseline survives untouched. RFC-0002's "the
  baseline is discarded" described only the first-run case.
- A partial failure still commits, with its error rows visible, as before.
- Listing and id validation still happen before the transaction, so a discovery
  failure never touches the old baseline.
- Before rolling back, every in-flight capture job is allowed to settle. A job
  that throws is recorded and later jobs skip their work; the error is rethrown
  once all have finished. Otherwise a sibling saving after `ROLLBACK` would
  autocommit into the restored baseline. `ROLLBACK` is guarded by
  `db.inTransaction`, since SQLite may already have rolled back, and progress
  stops on failure too.

## Consequences

- A crash mid-capture can no longer leave half a baseline.
- The write lock is held for the whole prod capture. Nothing else writes to the
  file during a snapshot, so this costs nothing in practice.
- An unreachable prod is an operational failure (exit 2), not a run of error
  rows (exit 1). There is nothing to diff against, so no report is written.
