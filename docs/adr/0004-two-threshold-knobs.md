# ADR-0004: Two separate threshold knobs, named to keep them apart

**Date:** 2026-07-03 · **Status:** Accepted

## Context

Visual diffing has two genuinely different tolerances, and tools routinely
conflate them into one confusing "threshold" setting:

1. How different two **pixels** must be before they count as changed (anti-
   aliasing and subpixel rendering vary between runs and machines).
2. How much of a **page** must change before the page is called a regression.

## Decision

Expose both, with names that cannot be mistaken for each other:

- `diff.threshold` — pixelmatch's per-pixel color/AA sensitivity (0..1).
- `diff.failScore` — the page-level gate: the fraction of changed pixels that
  flips a comparison to "fail".

`diff.overrides` tunes `failScore` per path glob (e.g. a noisy `/blog/**`), and
`resolveFailScore` in `src/pipeline/verdict.ts` resolves the effective value.

## Consequences

- `diff_score = diff_pixels / (width × height)`, compared against the resolved
  `failScore`. Both live in the DB, so a report reader can see the raw number as
  well as the verdict.
- Two knobs is more surface than one, but the alternative — a single number that
  silently means different things at different magnitudes — is worse.
- Per-path overrides are matched with the same `matchPath` predicate used for
  `include`/`exclude`, so glob semantics are identical everywhere.
