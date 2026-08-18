# ADR-0013: Crawl is opt-in, and seeds from the other sources rather than replacing them

**Date:** 2026-07-04, amended 2026-07-05 · **Status:** Accepted

## Context

Crawling was originally on by default and modeled as a **fallback**: it ran only
when the sitemap produced nothing. Two problems emerged.

First, an always-on link crawl is a surprising default — it fetches far more of a
site than the user asked for, and `discovery.crawl` had to be written as an
object even when you only wanted to toggle it.

Second, the fallback model made crawl and sitemap mutually exclusive. Once
`discovery.urlList` arrived ([ADR-0014](0014-urllist-normalized-to-paths.md)),
"crawl only when the others found nothing" became the wrong shape: the natural
request is "start from my known pages and expand outward".

## Decision

**Opt-in.** `discovery.crawl` defaults to `false` and accepts a boolean or an
object:

| Input | Result |
| --- | --- |
| omitted / `false` | disabled |
| `true` | enabled with defaults |
| `{ maxDepth: 5 }` | enabled, `maxDepth` overridden |
| `{ enabled: false, … }` | explicitly disabled |

**Seeded expander, not fallback.** When enabled, crawl always runs, seeded by the
urlList ∪ sitemap union (falling back to `crawl.startPath` when there are no
seeds). `crawlPaths` takes `startPaths: string[]` and queues them all at depth 0.

## Consequences

- The object form keeps its `enabled` key so `crawl: { enabled: false }` still
  disables. Dropping it would silently turn that into *enabled* — a footgun. The
  top-level default is `false` (omitting it means off); the object-form `enabled`
  defaults to `true` (if you wrote an object, you meant crawl on).
- **Behavior change:** a site with no sitemap and no `crawl` config now discovers
  nothing and hits the existing "no pages discovered" error. Users who relied on
  auto-crawl must set `crawl: true`.
- **Behavior change:** crawl-enabled plus a non-empty sitemap used to mean crawl
  did not run. Now it runs, seeded by the sitemap. Only configs that had already
  opted in are affected.
- This retired a workaround at both call sites, which had been setting
  `sitemap: false` whenever `--crawl` was passed in order to force the old
  fallback branch. Under seeding that would wrongly discard the sitemap seeds.
- Traversal stays bounded by `maxDepth` (default 3). With `maxPages: 0`, depth is
  the only bound.
