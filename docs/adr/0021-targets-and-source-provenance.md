# ADR-0021: Targets replace page paths; `source` is provenance, not behavior

**Date:** 2026-10-16 · **Status:** Accepted · **Implements:** [RFC-0001](../rfcs/0001-targets.md)

## Context

The pipeline's unit of work was a page path at a viewport. Scenarios
(RFC-0004) and Storybook stories (RFC-0005) are not paths shared by dev and
prod, and adding each as a special case would fork discovery, capture, storage
and the report.

## Decision

The unit of work is a **target** at a viewport: a stable `id`, a `label`, the
`path` globs match against, a URL per side, an optional `recipe`, and optional
narrowed `viewports` (`src/targets/target.ts`). Targets come from **sources**
behind one interface (`listForSnapshot`, `listLive`). `pages` is the only source
today.

Each target records its `source`. Capture, diff and gating never branch on it;
anything that must behave differently goes in the target's recipe, which the
source supplies. `source` has exactly two jobs: scoping added/removed detection
(ADR-0022), and keeping ids unique. Page ids are bare paths starting with `/`,
so pre-targets baselines keep matching. Every other source prefixes its name
(`scenarios:nav-open`).

Both image tables are keyed on `(target_id, viewport)`. Pre-targets DBs are
rebuilt in place with `target_id = label = path` and `source = 'pages'`.

`Job` keeps its flat page shape with optional identity and `action` fields, and
`snapshotPipeline`/`runFlow` keep their `discover` seam. That way the existing
e2e tests prove pages-only behavior is unchanged.

## Consequences

- Adding a source means writing a `TargetSource`, never editing capture or diff.
- Page ids are paths forever. Changing that would invalidate every baseline.
- The `targets` id filter from RFC-0001 is deferred to RFC-0004, the first
  source whose ids aren't paths.
