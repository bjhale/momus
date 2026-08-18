# ADR-0011: `run` always diffs against a stored baseline, materializing one if absent

**Date:** 2026-07-04 · **Status:** Accepted (refresh mechanism amended by [ADR-0020](0020-run-snapshot-flag.md))

## Context

Introducing the prod baseline ([ADR-0009](0009-baseline-in-same-db.md)) left
`run` with two hand-written branches sharing only the diff/gate/save core:

- **One-shot** (no baseline): discover from prod, capture prod live, never
  persist it.
- **Baseline** (snapshot present): read prod from `baseline_images`, no
  discovery, no prod capture.

These are not one thing done two ways — they are two pipelines. The visible
symptom was the report header: `startRun` wrote `runs.prod_base_url =
config.prod` in both modes, which is only correct in one-shot. The deeper cause
was that one-shot captured prod and threw it away instead of materializing a
baseline.

## Decision

Collapse them. `run` **always** diffs live dev against a stored prod baseline.
When none exists, `run` materializes one in the same invocation (discover +
capture prod → baseline tables) and then proceeds down the single path.
`runFlow` (`src/pipeline/run-flow.ts`) owns this; `runCommand` is thin wiring.

**Freeze:** once materialized, later runs reuse the baseline and never re-hit
prod. `momus snapshot` is the refresh mechanism.

The original decision added no refresh flag on `run` — YAGNI, since
`momus snapshot` covered it. That call was later overturned; see
[ADR-0020](0020-run-snapshot-flag.md).

## Consequences

- Discovery and live prod capture exist in exactly one place,
  `snapshotPipeline`. The entire one-shot branch was deleted.
- Provenance is correct everywhere: `runPipeline` takes `prodBaseUrl` and
  `runFlow` passes `snapshot.prodBaseUrl`, so `runs.prod_base_url` and the report
  header reflect the baseline's true origin.
- **Behavior change from the pre-baseline tool:** a plain `run` no longer
  re-captures prod every time. Console output states which happened — "Captured
  prod baseline (N pages)" versus "Reused prod baseline from `<created_at>`" —
  so freezing is never silent.
- On a first `run`, prod is captured in one phase and dev in another rather than
  near-simultaneously per page. That skew is inherent to a frozen baseline;
  masking is the mitigation.
- The `listJobs` / `getDev` / `getProd` seams in `runPipeline` are kept even
  though `getProd` is now always a store lookup — they are the injection points
  the pipeline tests use, so they are testability infrastructure rather than dead
  generality.
- **Open question:** if the first `run` materializes while prod is unreachable,
  every capture fails and the baseline still freezes with all-error rows;
  subsequent runs reuse it until `momus snapshot` is re-run. The console message
  surfaces the ok/failed split, but whether an all-error materialize should be
  allowed to freeze at all is undecided. The options are to refuse to write a
  snapshot when every capture failed (exit 2, no freeze), or to write it without
  freezing.
