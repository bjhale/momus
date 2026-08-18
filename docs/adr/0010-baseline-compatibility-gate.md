# ADR-0010: Hard-fail when a baseline isn't diffable against the live config

**Date:** 2026-07-04 · **Status:** Accepted

## Context

A stored prod baseline is only meaningful when dev is captured the same way. A
dev capture at 1280px diffed against a prod capture at 768px is ~100% "changed" —
a technically valid number that tells you nothing. The same goes for different
masking, a different settle time, or a different browser engine.

Once the baseline is frozen, the live config can drift away from it silently.

## Decision

`baselineConflict` (`src/pipeline/compat.ts`) compares the live config against
the `snapshot` row field by field before any diffing, and a mismatch is a **hard
error, exit 2**, naming the field that differs. Gated fields:

- `browser`
- `viewports`
- `stabilize` — `waitUntil`, `settleMs`, `timeoutMs`, `disableAnimations`,
  `mask`, `remove`

Everything else is legitimately run-specific and deliberately not gated: `dev`,
`concurrency`, `diff.*` thresholds, `output.*`.

## Consequences

- Comparison is field-by-field rather than a JSON deep-equal, so SQLite or
  `JSON.stringify` key ordering can never produce a false mismatch.
- New gated fields must default gracefully for baselines captured before they
  existed: `stabilize.remove` reads as `?? []` and `browser` as `?? "chromium"`,
  so an old baseline stays diffable instead of erroring on a field it never had.
- Adding a field to `stabilize` means deciding whether it belongs in the gate.
  Anything that changes captured pixels does.
- **Known gap:** the gate does *not* compare `snapshot.prod_base_url` against
  `config.prod`. A DB pointed at a second site therefore diffs against the first
  site's baseline and produces a clean-looking report full of garbage. See
  [ADR-0020](0020-run-snapshot-flag.md).
