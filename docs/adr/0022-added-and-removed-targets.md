# ADR-0022: Added and removed targets are their own statuses; the baseline determines page paths

**Date:** 2026-10-16 · **Status:** Accepted · **Implements:** [RFC-0001](../rfcs/0001-targets.md)

## Context

The baseline's rows defined a run's jobs, so a target missing from either side
was invisible. Discovery is single-sided and runs only at snapshot time
([ADR-0008](0008-discovery-is-single-sided.md),
[ADR-0011](0011-run-always-diffs-a-baseline.md)), so a run cannot re-find pages
without touching prod or reversing ADR-0008.

## Decision

- A run compares each source's **live** list with the baseline. A live
  `(target, viewport)` with no baseline row is **`added`**: dev is captured and
  shown alone. A baseline row its source no longer lists is **`removed`**: the
  baseline capture is shown alone.
- Both **fail the gate (exit 1)** by default. `diff.allowAdded`/`--allow-added`
  and `diff.allowRemoved`/`--allow-removed` make them informational. Neither is
  an `error`.
- **Pages: the baseline determines the paths.** The pages live list is the
  baseline's paths plus any `urlList` entries the baseline lacks. The file is
  re-read on every run, which needs no network and no prod. Sitemap and crawl
  pages are never `added`, and no page is ever `removed`. Dropping a page takes
  a snapshot, or `momus baseline drop` once RFC-0003 ships.
- `maxPages` caps the `urlList` itself, after `include`/`exclude` and dedupe, in
  file order ([ADR-0012](0012-maxpages-cap-semantics.md): urlList seeds come
  first). Every capped entry missing from the baseline is `added`; baseline
  paths are always kept. Entries the cap dropped at snapshot are exactly those
  beyond `maxPages` in file order, so they stay excluded rather than being
  `added` forever, and nothing listed within the cap is hidden, even when the
  baseline is already full.
- Full-URL `urlList` entries are parsed against the baseline's prod origin, so
  changing `prod` after a snapshot doesn't fail the pages source.
- A source that fails to list during a run yields **one** error row
  (`source:<name>`, viewport 0), and its baseline rows are skipped. The run
  continues and exits 1. A source that fails during a snapshot fails the
  snapshot (exit 2) and keeps the old baseline.

## Consequences

- A page that is new on dev is invisible unless it's listed in `urlList`. That
  is the accepted cost of single-sided discovery.
- An unreadable `urlList` during a run reports one pages error instead of
  comparing pages.
- Resolving `added`/`removed` by approval arrives with RFC-0003.
