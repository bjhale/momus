# RFC-0001: Targets: generalize "page path"

**Status:** Draft · **Milestone:** M1 · **Created:** 2026-10-16

## Summary

Replace the pipeline's unit of work, a page `path` × `viewport`, with a
**target** × `viewport`. A target has a stable id, a URL to load on each side,
and an optional capture recipe. Today's discovered pages become one kind of
target. Scripted scenarios ([RFC-0004](0004-scripted-interactions.md)) and
Storybook stories ([RFC-0005](0005-storybook.md)) become two more, without
forking the pipeline.

## Motivation

Every planned capture source, other than site pages, breaks the assumption that
"what to compare" is a URL path shared by dev and prod:

- A **scenario** is the same path captured several times in different states:
  menu open, form errored, logged in.
- A **story** is identified by a story id. Its URL is an iframe address that
  depends on where the Storybook is served.
- An **element capture** is one region of a page, not the full page.

Bolting each of these onto `path` would leave three special cases in discovery,
capture, storage and the report.

## Today

- `ComparisonRecord` and both image tables are keyed by `(path, viewport)`
  ([types.ts](../../src/types.ts), [db.ts](../../src/store/db.ts)).
- Discovery returns paths ([discover.ts](../../src/discovery/discover.ts)).
  `dev` and `prod` URLs are built by joining a path onto each base URL
  ([ADR-0008](../adr/0008-discovery-is-single-sided.md)).
- `diff.overrides` and the report both match and display by path.

## Proposal

```ts
interface Target {
  id: string;          // stable, unique within a project; the DB key
  kind: "page" | "scenario" | "story";
  label: string;       // what the report shows
  path: string;        // what include/exclude and diff.overrides match against
  url: { dev: string; prod: string };
  recipe?: Recipe;     // steps and/or element selector (RFC-0004)
}
```

- **Page targets** come from existing discovery. Their `id` is the path, so a
  pages-only config produces identical ids, and existing baselines keep
  matching.
- **Target sources** are pluggable behind one interface:
  `listTargets(config) → Target[]`. Discovery becomes the `pages` source; RFC-0004
  and RFC-0005 add `scenarios` and `storybook`. A project may combine sources.
- **Storage** keys on `(target_id, viewport)`. The `path` column stays, holding
  the target's `path`.
- **Globs** (`include`, `exclude`, `overrides`) keep matching `path`. A
  `targets` filter matching `id` is added for kinds whose ids aren't paths.
- **Per-target viewports.** A target may narrow the configured viewport list.
  A component story rarely needs 375 px, 768 px *and* 1280 px. It can never add
  widths the baseline lacks.

## Non-goals

- Per-target browser engines. One run uses one engine, as
  [ADR-0019](../adr/0019-selectable-browser-engine.md) decided.
- A plugin system for third-party target sources. The interface is internal
  until [RFC-0009](0009-stability-contract.md) decides what is public.

## Compatibility

- **Migration** ([RFC-0002](0002-storage-and-run-history.md)): add
  `target_id`, backfilled from `path`, and move the unique key to it.
- A pages-only config produces the same ids and URLs as today, so existing
  baselines stay diffable.
- **Compatibility gate:** a recipe changes captured pixels, so a target's
  recipe is stored with its baseline row and compared per target. A changed
  recipe makes *that target* incompatible, reported as a per-target error row,
  not as exit 2 for the whole run. That is a deliberate narrowing of
  [ADR-0010](../adr/0010-baseline-compatibility-gate.md). It needs its own ADR,
  because editing one scenario must not invalidate a 500-page baseline.

## Open questions

- Should a target present in the baseline but missing from the live list
  (and the reverse) be an error row, a distinct "added/removed" status, or
  silently ignored? Today the baseline's rows define the jobs, so new pages are
  invisible until the next snapshot. That is surprising.
- Is `kind` needed in the data model, or is it only presentation?

## Done when

- [ ] `Target` replaces `path` as the pipeline's unit of work end to end.
- [ ] The DB migrates to `target_id` keys, and existing baselines diff unchanged.
- [ ] Pages-only behavior is byte-identical: the same ids, URLs and report
      ordering. Covered by the existing e2e tests passing unmodified.
- [ ] Per-target recipe compatibility is gated per target, with an ADR.
- [ ] Added/removed targets have defined, tested behavior.
