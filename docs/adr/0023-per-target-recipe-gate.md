# ADR-0023: A target's recipe is gated per target

**Date:** 2026-10-16 · **Status:** Accepted · **Amends:** [ADR-0010](0010-baseline-compatibility-gate.md)

## Context

ADR-0010 makes any capture-affecting mismatch between config and baseline a
whole-run hard error (exit 2). Recipes (RFC-0004) are per target. Applied
globally, editing one scenario would invalidate a 500-page baseline.

## Decision

Each baseline row stores `recipe_json`: the target's recipe, canonicalized with
sorted keys. On a run, a target whose live recipe differs from its stored one is
an `error` row for that target only, telling you to re-snapshot. The rest of the
run proceeds. The global gate (browser, viewports, stabilize) is unchanged.

## Consequences

- Recipes stay opaque until RFC-0004 defines them, but the gate already exists.
  Pre-targets rows have `recipe_json = NULL`, which matches "no recipe".
- Key order in a config file never reads as a changed recipe.
