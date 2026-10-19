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
The first capture is the one kept. If the second capture fails (or throws), the first
is kept unmarked: a failed capture says nothing about whether the pixels move,
and it must not roll back a baseline that captured fine once.

**A comparison against an unstable image is `unstable` only if every change
region touches a region the baseline moved in** (within one 16 px clustering
cell). Then it is diffed, stored and shown with the moving regions outlined
(dashed), but doesn't fail the gate, isn't in the passed/failed counts, and
isn't retried: that diff can't be trusted in either direction, and the fix is
a mask, not a code change. A change anywhere else is gated as usual, and
retried like any failure, with the moving regions still drawn. Waiving the
whole page would let one blinking caret hide a broken layout. A capped region
list (over 100) can't prove every change is covered, so it is gated. Unstable
comparisons are counted in the report header and on `run`'s last stdout line,
since they don't move the exit code. An error on that comparison (dev failed
to capture) is still an error.

**`retries` is top-level** (as the RFC writes it), an integer 0–10, default 0.
It re-captures **dev**, never prod, since the baseline is frozen. A compared
target is retried while it fails the gate and a retry could change that: a dev
capture error, a diff error, or a score over `failScore`. A baseline error is
never retried; re-reading the same stored error can't help. The number of
retries is stored on the comparison and shown in the report.

Neither setting is gated: neither changes the pixels of a capture.

## Consequences

- The moving regions themselves are never tested until masked, and a change
  right next to one can hide in it. The rest of the page is still gated.
- Retries can turn a flaky dev into a pass. The count stays on the row, so the
  flake is reviewable rather than swallowed.
- `verify` doubles snapshot time; it is opt-in for that reason.
