# Design: Unify `run` into a single ensure-baseline → diff path

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Builds on:** [2026-07-04-prod-snapshot-baseline-design.md](2026-07-04-prod-snapshot-baseline-design.md)

## Problem

The prod-snapshot feature left `momus run` with two hand-written branches that
only share the diff/gate/save core:

- **One-shot** (no baseline): discovers from prod, captures prod **live** from
  `config.prod`, and never persists it.
- **Baseline** (snapshot present): reads prod from `baseline_images` (whose true
  origin is `snapshot.prod_base_url`); no discovery, no prod capture.

They are not "the same thing done two ways" — they are two different pipelines.
The visible symptom is the report header: `runPipeline`'s `startRun` writes
`runs.prod_base_url = config.prod` in both modes, which is correct only in
one-shot; in baseline mode prod actually came from the snapshot, so the label can
be wrong. The deeper root cause is that one-shot captures prod inline and throws
it away instead of materializing a baseline, so there is no single "run against a
baseline" path.

## Goal

Collapse the two branches into one: a `run` always diffs live dev against a
stored prod baseline. When no baseline exists, `run` **materializes one in the
same invocation** (discover + capture prod → baseline tables), then proceeds down
the one baseline path. `momus snapshot` remains the "capture prod only" command
and becomes the refresh mechanism.

## Decision: freeze prod on first run

Once a plain `momus run` materializes prod into the baseline tables, later plain
runs **reuse** that frozen baseline (no prod hit). To re-capture prod, re-run
`momus snapshot` (which clears + rewrites the baseline). This is a deliberate
behavior change from the previous one-shot semantics (where every run re-captured
live prod) and must be documented. There is no `--refresh` flag (YAGNI —
`momus snapshot` covers it).

Consequence: on a first `run`, prod is captured during the materialize phase and
dev during the diff phase — two phases rather than the previous near-simultaneous
per-job pair. This temporal skew is inherent to a frozen baseline and is the same
skew baseline mode already accepts; masking of dynamic regions is the existing
mitigation.

## 1. Unified `runCommand` flow

Replaces the `if (snapshot) { ... } else { ... }` in `src/commands/run.ts`:

```
snapshot = readSnapshot(db)
if (!snapshot) {                       // no baseline yet → materialize it now
    await snapshotPipeline({ config, db, createdAt: now, discover, captureFn })
    snapshot = readSnapshot(db)        // now non-null
}
const conflict = baselineConflict(config, snapshot)
if (conflict) { console.error(...); return 2 }   // no-op right after materialize
await runPipeline({ ...baseline diff wiring..., prodBaseUrl: snapshot.prodBaseUrl })
// report + exit code as today
```

- The entire one-shot branch ([run.ts:76-100]) is **deleted**. Discovery and
  live prod capture now live in exactly one place: `snapshotPipeline` (built in
  the prior feature, `src/pipeline/snapshot.ts`).
- `run`'s discovery wiring (the `discoverPaths({...})` call honoring `--crawl`)
  moves into the `snapshotPipeline` `discover` closure — it is no longer inlined
  in a `listJobs`.
- `momus snapshot` is unchanged; it is the "capture prod only, no dev/diff/
  report" command and the way to refresh a frozen baseline.

## 2. Provenance fix (resolves the deferred follow-up)

Prod now always originates from the `snapshot` row, so:

- `runPipeline`'s `startRun` records the baseline's prod URL, not `config.prod`.
  Add an optional `prodBaseUrl?: string` to `RunPipelineArgs` (defaulting to
  `config.prod` for backward compatibility of the pipeline in isolation);
  `runCommand` passes `snapshot.prodBaseUrl`. Result: `runs.prod_base_url` is
  accurate in every case, so the report header (rendered from that row) is
  correct.
- Console output states baseline provenance so freezing is never silent:
  - fresh: `Captured prod baseline (N pages). Wrote <report> (N comparisons). Exit <code>.`
  - reused: `Reused prod baseline from <snapshot.created_at>. Wrote <report> (N comparisons). Exit <code>.`

  `runCommand` distinguishes the two by whether it just materialized the baseline
  (the `!snapshot` branch was taken).

No change to the report template is required beyond it already reading
`run.prod_base_url`; surfacing `created_at` in the report header is optional and
out of scope (console output carries it).

## 3. `runPipeline` seams stay

After unification, `getProd` is always the store lookup and `getDev` always a
live capture. The `listJobs` / `getDev` / `getProd` seams are **kept**: they are
the injection points the pipeline unit tests use (fake seams, no browser), so
they are testability infrastructure, not now-dead generality. The prior feature's
`Job` interface and pipeline are unchanged except for the new optional
`prodBaseUrl` arg.

## 4. Behavior & docs

- `momus run` with no baseline: materializes a durable baseline AND produces the
  report in one invocation; subsequent runs reuse it (freeze).
- Refresh prod: re-run `momus snapshot`.
- README updates: the `run` section and "How it works" state that `run` captures
  and freezes prod on first use and reuses it thereafter; refresh via
  `momus snapshot`. The "Notes & known limitations" prod-label caveat (if any
  remains) is removed since provenance is now correct.

## 5. Error handling & exit codes

Unchanged in spirit:

| Case | Code |
| --- | --- |
| `run`, baseline materialized or reused, all pages pass | 0 |
| `run`, any page fails the gate or errors | 1 |
| `run`, operational failure (no browser, bad config, discovery threw during materialize, baseline conflict) | 2 |

A first `run` whose materialize phase fails discovery exits 2 exactly as
`momus snapshot` would (discovery throws → caught → 2), leaving no partial
baseline (per the existing discover-before-clear ordering in `snapshotPipeline`).

## 6. Testing

- **`run` with no baseline (materialize-in-run):** after one invocation, the
  `snapshot` + `baseline_images` tables are populated AND `comparisons`/report
  exist; assert prod was captured/persisted and the report/exit code are correct.
- **`run` twice (freeze):** the second invocation does NOT run discovery or a
  live prod capture (assert the prod/discovery seam is never invoked), reuses the
  frozen baseline, and still writes a report.
- **Conflict after config change:** an existing baseline + changed
  viewports/stabilize → exit 2 (unchanged).
- **Provenance:** with `snapshot --prod X` then `run` under a config whose
  `prod` differs, `runs.prod_base_url` / the report header reflect `X` (the
  snapshot origin), not the live config — the case that previously mislabeled.
- **Console output:** fresh vs reused messages assert the "Captured" vs "Reused …
  from <created_at>" wording.
- Existing snapshot / baseline-roundtrip / e2e tests are updated for the merged
  path; the old one-shot-branch wiring and its assertions are removed.

## Out of scope

- `--refresh` / `--no-baseline` flag on `run` (re-run `momus snapshot` instead).
- Surfacing `snapshot.created_at` in the HTML report header (console carries it).
- Any change to discovery, diffing, or gating behavior.
