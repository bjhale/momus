# ADR-0014: `urlList` entries normalize to paths; off-base URLs are a hard error

**Date:** 2026-07-05 · **Status:** Accepted

## Context

Users wanted to supply an explicit page list from a newline-delimited file rather
than relying on a sitemap or a crawl. The file may mix full URLs and bare paths.
The natural mental model users described was "string-replace the prod base with
the dev base".

## Decision

Normalize every entry to a **path** in `parseUrlList` (`src/discovery/urllist.ts`,
pure and unit-tested), then let it flow through the existing pipeline unchanged:

- Full URL under the prod base → the remainder after the base (empty → `/`).
- Bare path → leading `/` ensured.
- Fragments stripped, query strings kept, blank lines skipped.
- **Full URL not under the prod base → throw** (exit 2), naming the offending
  line.

The list unions with the sitemap into a seed set, urlList first
([ADR-0013](0013-crawl-is-opt-in-and-seeded.md)), and then goes through the same
`include`/`exclude` filter, dedup, `maxPages` cap, and sort as everything else.

## Consequences

- The base-swap the user described becomes **emergent** rather than implemented:
  discovery returns paths, and the pipeline already joins each path onto both
  bases, so `new URL(path, config.dev)` *is* the swapped dev URL while
  `new URL(path, config.prod)` reconstructs the original.
- Rejecting off-base URLs is the alternative to silently mis-targeting them.
  A URL on another host has no meaningful path relative to the prod base, so
  swapping it would produce a plausible-looking request to the wrong page.
- Nothing is exempt from the cap: 502 urlList entries with `maxPages: 500` yields
  500 pages. urlList seeds come first, so they win both dedup precedence and the
  cap budget over sitemap entries.
- With crawl enabled, seeds are fetched during discovery, so an unreachable seed
  is simply not collected. With crawl disabled they are not fetched, and an
  unreachable one surfaces later as an error comparison.
- No `--url-list` CLI flag — config only, matching `mask`/`remove`.
