# ADR-0034: An unstable baseline image never fails the gate; `retries` re-captures dev only

**Date:** 2026-10-18 · **Status:** Accepted · **Implements:** [RFC-0006](../rfcs/0006-capture-determinism-and-diff-quality.md)

## Context

RFC-0006 adds two ways to tell flakiness from regressions. `stabilize.verify`
captures each baseline image twice and marks the ones that differ unstable;
`retries: N` re-captures a target that failed. The RFC leaves open what each
does at the edges: which side is retried, what counts as differing, and what
an unstable target does to the exit code.

## Decision

**`verify` runs at baseline capture only**, because that is the only time prod
is captured: a run against a frozen baseline never touches prod
([ADR-0011](0011-run-always-diffs-a-baseline.md)). The two captures are diffed
at `diff.threshold` with `diff.includeAA`. Any differing pixel marks the image
unstable, and the change regions are stored on it (`unstable_regions_json`).
The first capture is the one kept. If the second capture fails, the first is
kept unmarked: a failed capture says nothing about whether the pixels move.

**A comparison against an unstable image is `unstable`**: diffed, stored and
shown with the moving regions outlined, but never failing the gate, never in
the passed/failed counts, and never retried. Its diff can't be trusted in
either direction, and the fix is a mask, not a code change. It is counted in
the report header so it can't go unnoticed. An error on that comparison (dev
failed to capture) is still an error.

**`retries` is top-level** (as the RFC writes it), an integer 0–10, default 0.
It re-captures **dev**, never prod, since the baseline is frozen. A compared
target is retried while it fails the gate and a retry could change that: a dev
capture error, a diff error, or a score over `failScore`. A baseline error is
never retried; re-reading the same stored error can't help. The number of
retries is stored on the comparison and shown in the report.

Neither setting is gated: neither changes the pixels of a capture.

## Consequences

- A page that is unstable forever is never tested. That is visible (an
  UNSTABLE badge and a header count), not silent, and masking the regions
  shown is the way out.
- Retries can turn a flaky dev into a pass. The count stays on the row, so the
  flake is reviewable rather than swallowed.
- `verify` doubles snapshot time; it is opt-in for that reason.
