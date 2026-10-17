# RFC-0001: Targets: generalize "page path"

**Status:** Implemented · **Milestone:** M1 · **Created:** 2026-10-16 · **ADRs:** [0021](../adr/0021-targets-and-source-provenance.md), [0022](../adr/0022-added-and-removed-targets.md), [0023](../adr/0023-per-target-recipe-gate.md)

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
  id: string; // stable, unique within a project; the DB key
  source: "pages" | "scenarios" | "storybook"; // provenance, never a behavior switch
  label: string; // what the report shows
  path: string; // what include/exclude and diff.overrides match against
  url: { dev: string; prod: string };
  recipe?: Recipe; // steps and/or element selector (RFC-0004)
}
```

- **Page targets** come from existing discovery. Their `id` is the path, so a
  pages-only config produces identical ids, and existing baselines keep
  matching.
- **Target sources** are pluggable behind one interface:
  `listTargets(config) → Target[]`. Discovery becomes the `pages` source; RFC-0004
  and RFC-0005 add `scenarios` and `storybook`. A project may combine sources.
- **Storage** keys on `(target_id, viewport)`. The `path` and `source` columns
  are stored alongside it.
- **Globs** (`include`, `exclude`, `overrides`) keep matching `path`. A
  `targets` filter matching `id` is added for sources whose ids aren't paths.
- **Per-target viewports.** A target may narrow the configured viewport list.
  A component story rarely needs 375 px, 768 px _and_ 1280 px. It can never add
  widths the baseline lacks.

### `source` is provenance, not behavior

Each target records which source listed it. Capture, diff and gating **never
branch on `source`**. Anything that has to behave differently, such as a
story's render wait or element capture, is expressed in the target's `recipe`.
The source supplies that recipe, so the pipeline needs no special cases. Adding
a source must never mean editing capture or diff.

`source` has exactly two jobs:

- **Scoping added and removed detection.** Each source either lists its
  targets or fails. Only baseline rows from sources that listed successfully
  can be reported `removed`. A source that fails to list (Storybook's
  `index.json` unreachable, say) gets one source-level error row naming it, and
  its baseline rows are skipped for that run. The other sources still run, and
  the run exits 1, because an error is never a silent pass
  ([ADR-0006](../adr/0006-errors-are-rows.md)). Without this, one failed fetch
  would report every story as `removed`.
- **Keeping ids unique across sources.** Page ids are bare paths and always
  start with `/`, which keeps existing baselines matching. Every other source
  prefixes its ids with its name, as in `scenarios:nav-open` and
  `storybook:button--primary`, so ids from different sources can't collide.

The report's source badge and filter, and the 2.0 server's history grouping
([RFC-0010](0010-server.md)), read the field too. Those are presentation;
nothing depends on them.

### Added and removed targets

Each run compares the **live** target list against the baseline's, and gives
the difference two statuses of its own. A mismatch is never an error row and
never silently ignored:

| Status    | Meaning                                | Report shows                | Gate           |
| --------- | -------------------------------------- | --------------------------- | -------------- |
| `added`   | In the live list, not in the baseline. | The dev capture alone.      | Fails (exit 1) |
| `removed` | In the baseline, not in the live list. | The baseline capture alone. | Fails (exit 1) |

- **Why fail by default:** an added target nobody has looked at, or a page that
  disappeared, is an unreviewed change. Exit 1 already means "something needs a
  human" ([ADR-0006](../adr/0006-errors-are-rows.md)). Passing silently would
  be the "error is never a silent pass" mistake again.
- **Resolving one is approval** ([RFC-0003](0003-approval-workflow.md)).
  Approving an `added` target puts its dev capture into the baseline. Approving
  a `removed` one deletes its row from the baseline. Either way, the next run
  is clean.
- **Opting out:** `--allow-added` and `--allow-removed`, with matching config
  keys, make the status informational. It is still reported, but it doesn't
  fail the gate. This suits a docs site where pages come and go routinely.
- **Neither is an error.** `error` keeps its meaning, that a capture or diff
  failed. A target that errored on one side is `error`, not `added` or
  `removed`.
- **Granularity is `(target, viewport)`.** A target that narrows its viewports
  shows its dropped widths as `removed`.

#### Pages: the baseline determines the paths

Discovery stays single-sided
([ADR-0008](../adr/0008-discovery-is-single-sided.md)). It runs against prod,
at snapshot time only, and a frozen baseline still means `run` never touches
prod ([ADR-0011](../adr/0011-run-always-diffs-a-baseline.md)). For the
`pages` source, the live list on a `run` is therefore:

> the baseline's paths, plus any `urlList` entries that aren't in the baseline.

- **Sitemap and crawl** pages come only from the baseline. They can never be
  `added` (a page that is new on dev isn't found until the next snapshot) or
  `removed` (the baseline defines the list). This is the accepted cost of
  single-sided discovery; the README says so explicitly.
- **`urlList` is the way in for new pages.** The file is local and re-read on
  every `run`, which needs no network and no prod. An entry with no baseline
  row is captured on dev only and reported `added`. `include` and `exclude`
  apply to it as usual. This is the intended workflow for a branch that adds a
  page: list it, review it, approve it.
- **Pages are never `removed`.** Deleting an entry from `urlList` doesn't drop
  its baseline row. It is still captured until the next snapshot rebuilds the
  baseline without it, or until it's dropped with `momus baseline drop`
  ([RFC-0003](0003-approval-workflow.md)). That keeps "the baseline determines
  the paths" true without exception: a file edit never deletes baseline data.

`removed` therefore comes only from sources whose live list is independent of
the baseline: `scenarios` (the config) and `storybook` (`index.json`).

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
  recipe makes _that target_ incompatible, reported as a per-target error row,
  not as exit 2 for the whole run. That is a deliberate narrowing of
  [ADR-0010](../adr/0010-baseline-compatibility-gate.md). It needs its own ADR,
  because editing one scenario must not invalidate a 500-page baseline.

## Open questions

- None yet.

## Done when

- [x] `Target` replaces `path` as the pipeline's unit of work end to end.
- [x] The DB migrates to `target_id` keys, and existing baselines diff unchanged.
- [x] Pages-only behavior is byte-identical: the same ids, URLs and report
      ordering. Covered by the existing e2e tests passing unmodified.
- [x] Per-target recipe compatibility is gated per target, with an ADR.
- [x] `source` is stored per row; ids are unique across sources; a source that
      fails to list yields one error and no false `removed` rows. Tested with a
      failing fake source.
- [x] No branch on `source` in capture or diff. Checked in review and recorded
      in an ADR.
- [x] Pages: a `run` reads `urlList` fresh, reports entries missing from the
      baseline as `added`, never reports sitemap or crawl pages as `added`, and
      never reports any page `removed`. Discovery still never runs during a
      `run` against a frozen baseline.
- [ ] `added` and `removed` statuses are stored, shown in the report, fail the
      gate by default, honor `--allow-added` and `--allow-removed`, and are
      resolved by approval. Recorded in an ADR. (deferred — see Revisions)

## Revisions

- **2026-10-16: implemented.** Changes from the accepted text:
  - The `targets` id filter is deferred to [RFC-0004](0004-scripted-interactions.md),
    the first source whose ids aren't paths.
  - `maxPages` caps the `urlList` (in file order, after filters), and every
    entry within the cap that the baseline lacks is `added`.
  - Resolving `added`/`removed` by approval ships with
    [RFC-0003](0003-approval-workflow.md); until then, re-snapshot or allow them.
