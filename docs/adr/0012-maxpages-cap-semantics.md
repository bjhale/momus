# ADR-0012: One global `maxPages` cap, counted after filtering

**Date:** 2026-07-04 · **Status:** Accepted

## Context

The crawler bounded itself with `crawl.maxPages`, but the sitemap path was
uncapped — a large sitemap produced an unbounded number of comparisons, and the
knob that existed only applied to one of the two discovery sources.

Two sub-questions followed. Does the cap count raw discovered entries or entries
that survive `include`/`exclude`? And is it applied before or after the
alphabetical sort?

## Decision

Replace `discovery.crawl.maxPages` with a single top-level
`discovery.maxPages` (default 500, `0` = unlimited) that caps whichever sources
ran.

The cap counts **pages that survive `include`/`exclude`**, and is applied in
**discovery order, before the sort**:

```
kept    = raw.filter(include/exclude)
deduped = dedupe preserving first-seen order
capped  = maxPages === 0 ? deduped : deduped.slice(0, maxPages)
return    capped.sort()
```

## Consequences

- `maxPages: 500` yields up to 500 pages that will actually be compared, not 500
  raw entries some of which get filtered away.
- Slicing before sorting means the cap keeps the first N in *discovery* order —
  sitemap document order or crawl BFS order — not the alphabetically first N.
  Dedup must therefore preserve first-seen order (a `Set` does), or "first N" is
  undefined.
- For the post-filter semantics to hold on the crawl path, the crawler takes the
  same `keep` predicate `discoverPaths` builds, counting only surviving pages
  toward the cap while still **traversing through** excluded pages to reach
  included ones (exclude `/category/**`, still follow its links to
  `/product/**`). `discoverPaths` re-applies the filter and cap afterwards, so
  there is one authoritative implementation and the crawler's copy is purely an
  early stop.
- The cap counts pages, not `path × viewport` jobs. Job count stays
  `cappedPaths × viewports`.
- An old config still carrying `crawl.maxPages` parses without error — Zod drops
  the unknown key — but the value is ignored.
