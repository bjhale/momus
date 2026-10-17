# RFC-0002: Storage versioning and run history

**Status:** Accepted · **Milestone:** M1 · **Created:** 2026-10-16

## Summary

Give the `.sqlite` file a schema version and ordered migrations, keep more than
one run, and make the baseline's identity complete. In the same milestone, close
the correctness gaps in the baseline model.

## Motivation

- **Approval needs history.** [RFC-0003](0003-approval-workflow.md) approves
  captures _from a run_. Today each `run` truncates the only run.
- **Migrations are ad hoc.** New tables appear through `CREATE TABLE IF NOT
EXISTS`, and one column was added with a guarded `ALTER TABLE`. That doesn't
  scale to the key change in [RFC-0001](0001-targets.md), and it can't tell a
  user that a DB is from a newer momus.
- **The baseline identity is incomplete.** The compatibility gate ignores
  `prod_base_url`, so a DB pointed at a different site produces a clean-looking
  report full of nonsense.
- **The DB is the input for 2.0.** The server
  ([RFC-0010](0010-server.md)) ingests runs. A run that the schema can't describe
  completely becomes a breaking change later.

## Today

- Four tables; `runs` has exactly one row (`id = 1`)
  ([ADR-0002](../adr/0002-sqlite-blobs-single-run-db.md),
  [ADR-0009](../adr/0009-baseline-in-same-db.md)).
- `run` truncates `runs` and `comparisons`; `snapshot` also clears the baseline.
- Known gaps ([AGENTS.md](../../AGENTS.md)):
  - The gate ignores `prod_base_url`.
  - `--prod` on `run` is silently ignored when a baseline exists.
  - An all-error materialize freezes
    ([ADR-0011](../adr/0011-run-always-diffs-a-baseline.md)).
  - `snapshot --snapshot` does nothing.

## Proposal

### Versioning

- Track the schema version with `PRAGMA user_version`. Migrations are an ordered
  list of `(version, up)` functions, each run in a transaction on open.
- A DB with a version **newer** than the running momus is an operational
  error (exit 2) with a clear message. It is never opened in a way that writes.
- A pre-versioning DB is detected by its tables, assigned version 1, and
  migrated forward.

### Run history

- `runs` gets real ids. `run` inserts a new run; it no longer truncates.
- A run's captures and diff images belong to that run alone. They are never
  deduplicated by content hash or shared between runs, even when they are
  byte-identical. A run's evidence never changes after it's written, and pruning
  a run is a plain delete with no reference counting.
- A **retention** setting, `output.keepRuns` (default 5; 0 means unlimited),
  prunes the oldest runs and their image BLOBs after each run, followed by an
  incremental vacuum. Without this the file grows with every run. The default
  is small because people commit the file to git. 5 gives approval
  ([RFC-0003](0003-approval-workflow.md)) a few recent runs to pick from without
  multiplying the file size by 20.
- The report renders one run, the latest by default; `momus report --run ID`
  re-renders an older one.
- Each run records its provenance: the momus version, engine and version, the
  config hash, and optional CI metadata (commit, branch, PR) from flags or
  environment variables ([RFC-0008](0008-cli-ci-integration.md)).

### Baseline identity and the known gaps

- The gate adds the baseline's prod origin. A mismatch is exit 2, naming both
  origins and the fix (`--snapshot`, or a separate `output.db`).
- `--prod` on `run` with an existing baseline becomes an error unless it matches
  the baseline's origin, rather than being silently ignored.
- A materialize where **every** job errored doesn't freeze. The baseline is
  discarded, the run exits 2, and the message says prod was unreachable. A
  partly erroring baseline still freezes, and its error rows stay visible.
- `momus snapshot --snapshot` becomes an error ("unknown flag for snapshot"),
  or else every command validates its flags. The latter is the better fix, and
  is listed as an open question in [RFC-0009](0009-stability-contract.md).

### Server-ready checklist

The schema must be able to answer, for any run, without the config file:

- [ ] Which momus version, engine and engine version produced it?
- [ ] Which baseline (id plus identity) was it diffed against?
- [ ] Which commit, branch or PR did it test, when CI metadata was provided?
- [ ] What was each target's verdict, score, and the gate that applied?

## Non-goals

- Storing images outside SQLite. BLOBs stay
  ([ADR-0002](../adr/0002-sqlite-blobs-single-run-db.md)); object storage is a
  server concern.
- More than one baseline per DB. Branch baselines are a 2.0 feature.

## Compatibility

Every migration is forward-only and tested against a fixture DB written by
v0.9.x. Old DBs open and migrate; their baseline stays diffable.

## Open questions

- None yet. Content-hash dedupe of BLOBs and the `keepRuns` default were
  resolved on 2026-10-17: no dedupe, and a default of 5.

## Done when

- [ ] Versioned migrations; a newer-version DB is refused with exit 2.
- [ ] A v0.9.x fixture DB migrates and its baseline diffs unchanged.
- [ ] Multiple runs are kept and pruned by `keepRuns`; `momus report --run ID`
      works.
- [ ] Every item in the known-gaps list is fixed and tested, and has an ADR
      superseding or amending ADR-0010 and ADR-0011.
- [ ] The server-ready checklist is answerable from the schema alone.
