# Design: Global maxPages cap + opt-in crawl

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan

## Problem

Two related discovery-config improvements:

1. **No global page cap.** The crawler self-bounds on `discovery.crawl.maxPages`,
   but the sitemap path is uncapped — a large sitemap yields an unbounded number
   of comparisons. We want one knob that limits total pages regardless of the
   discovery source (sitemap or crawl).
2. **Crawl config is rigid and on-by-default.** `discovery.crawl` must be an
   object even when you only want to toggle it, and crawl runs automatically as a
   fallback. We want crawl **off by default**, and `discovery.crawl` to accept a
   plain `false` (or `true`) shorthand.

## 1. Config changes

```ts
discovery: {
  sitemap: true,
  maxPages: 500,          // NEW — non-negative int, 0 = unlimited. Caps sitemap OR crawl.
  crawl: false,           // NEW default (was on). false | true | { startPath?, maxDepth?, enabled? }
  include: ["/**"],
  exclude: [],
}
```

### `discovery.maxPages`

- `z.number().int().nonnegative().default(500)`. `0` means unlimited.
- Replaces `discovery.crawl.maxPages`, which is **removed**. An old config still
  carrying `crawl.maxPages` parses without error (Zod drops the unknown key).

### `discovery.crawl` — boolean-or-object, default disabled

Accepts either a boolean or an object; normalized to the internal
`{ enabled: boolean, startPath: string, maxDepth: number }` shape so all
downstream code keeps reading `config.discovery.crawl.enabled/startPath/maxDepth`
unchanged.

| Input | Normalized result |
| --- | --- |
| *omitted* | `{ enabled: false, startPath: "/", maxDepth: 3 }` |
| `false` | `{ enabled: false, startPath: "/", maxDepth: 3 }` |
| `true` | `{ enabled: true, startPath: "/", maxDepth: 3 }` |
| `{ maxDepth: 5 }` | `{ enabled: true, startPath: "/", maxDepth: 5 }` |
| `{ enabled: false, … }` | `{ enabled: false, … }` (explicit disable, back-compat) |

Zod shape:

```ts
const CrawlObject = z.object({
  enabled: z.boolean().default(true),   // object present => opted in
  startPath: z.string().default("/"),
  maxDepth: z.number().int().positive().default(3),
});
crawl: z.union([z.boolean(), CrawlObject])
  .default(false)
  .transform((v) =>
    typeof v === "boolean"
      ? { enabled: v, startPath: "/", maxDepth: 3 }
      : v),   // object already carries {enabled, startPath, maxDepth} with defaults
```

Rationale for keeping the `enabled` key inside the object form: so
`crawl: { enabled: false }` still disables. Dropping it would silently turn that
into *enabled* — a footgun. Top-level default is `false` (omitting `crawl`
disables); the object-form `enabled` defaults to `true` (if you wrote an object,
you meant crawl on).

**Behavior change (document in README):** crawl previously ran automatically as a
fallback when the sitemap was empty. It is now opt-in. A site with no sitemap and
no `crawl` config discovers nothing and hits the existing `"no pages discovered"`
error. Users relying on auto-crawl must set `crawl: true`.

## 2. Cap semantics in `discoverPaths`

The cap is the final discovery step, applied to the ordered, filtered, deduped
stream — "first N survivors in discovery order," then sorted for output:

```
raw     = sitemap(...) (doc order)   OR   crawl(...) (BFS order)
kept    = raw.filter(include/exclude)        // post-filter (user decision)
deduped = dedupe preserving first-seen order
capped  = maxPages === 0 ? deduped : deduped.slice(0, maxPages)
return    capped.sort()                       // display order; throws if empty (unchanged)
```

The change from today is slicing **before** the alphabetical sort, so the cap
keeps the first N in *discovery* order, not the alphabetical first N. Dedup must
preserve first-seen order (a `Set` does) so "first N" is well-defined pre-sort.

The user decision: the cap counts **pages that survive `include`/`exclude`** — so
`maxPages: 500` yields up to 500 pages that will actually be compared, not 500
raw entries some of which get filtered away.

## 3. Crawler counts only surviving pages

For the post-filter semantics to hold on the crawl path, the crawler must count
only pages that pass the filter toward the cap, while still **traversing through**
excluded pages to reach included ones (e.g. exclude `/category/**` but follow its
links to `/product/**`). `crawlPaths` gains a `keep: (path: string) => boolean`
predicate, built by `discoverPaths` from `include`/`exclude` and shared.

```
CrawlOptions = { maxDepth: number; maxPages: number }   // maxPages = global cap; 0 = unlimited

crawlPaths(base, startPath, opts, keep, fetcher):
  while queue not empty AND (opts.maxPages === 0 || result.length < opts.maxPages):
    dequeue; skip if visited; mark visited
    fetch (needed for links regardless of keep); skip if !ok
    if keep(path): result.push(path); if capped and result.length >= maxPages: break
    if depth < maxDepth: enqueue same-host child links (all, for traversal)
  return result   // survivors in BFS order, already <= cap
```

`discoverPaths` still applies its own filter + cap over the crawler's output
(idempotent for crawl since the crawler already kept only survivors) — one
authoritative filter, with the crawler's `keep` acting as an early-stop so it
does not over-fetch. Traversal remains bounded by `maxDepth` (default 3), which is
the existing safety bound; `maxPages: 0` bounds the crawl only by `maxDepth`.

## 4. CLI: `--max-pages N`

- `cli.ts` `parseArgs`: add `"max-pages": { type: "string" }`; parse to
  `overrides.maxPages = Number(value)`.
- `CliOverrides` gains `maxPages?: number`.
- `resolveConfig`: `if (cli.maxPages !== undefined) merged.discovery = { ...(merged.discovery ?? {}), maxPages: cli.maxPages }`.
- CLI wins over config (existing convention).
- Help text lists `--max-pages N` for both `run` and `snapshot`.

## 5. Command wiring

Both discovery call sites — the `discover` closure in `src/commands/run.ts` and
`src/commands/snapshot.ts` — change their `discoverPaths({...})` args:

- Remove `maxPages` from the `crawl: { … }` sub-object.
- Add top-level `maxPages: config.discovery.maxPages`.

(`discoverPaths`'s `DiscoverArgs` moves `maxPages` from `crawl` to a top-level
field and constructs the `keep` predicate internally.)

## 6. Edge cases

- `maxPages: 0` → unlimited (crawler bounded only by `maxDepth`; sitemap uncapped).
- Cap ≥ available pages → all pages, no error.
- Filter leaves 0 (or cap of a filtered-empty set) → existing `"no pages discovered"` throw.
- The cap counts **pages** (paths), not path×viewport jobs; jobs stay `cappedPaths × viewports`.
- Negative `maxPages` → Zod validation error (config error, exit 2).

## 7. Testing

- **`discover.ts`**: sitemap capped to first-N-in-doc-order; cap applied *after*
  exclude (exclude reduces, then cap — not cap then exclude); `slice` precedes
  `sort` (assert a case where doc-order-first-N ≠ alphabetical-first-N);
  `maxPages: 0` = uncapped; crawl branch capped; dedup preserves order before cap.
- **`crawler.ts`**: counts only `keep`-passing pages toward `maxPages`; still
  traverses through excluded pages to reach kept ones; stops at N kept;
  `maxPages: 0` bounded by `maxDepth`; `keep`-reject-all within depth → empty.
- **`schema`**: `maxPages` default 500, rejects negatives, accepts 0; `crawl`
  union — omitted → disabled, `false` → disabled, `true` → enabled defaults,
  `{ maxDepth: 5 }` → enabled with override, `{ enabled: false }` → disabled;
  old `crawl.maxPages` ignored without error.
- **CLI**: `--max-pages` parsed and overrides config; `resolveConfig` merges it.
- **Command wiring**: both `run` and `snapshot` discovery calls pass the new
  top-level `maxPages` (covered where those wirings are exercised).

## 8. Docs

- README config example: `maxPages` at `discovery` level; `crawl: false` default;
  remove `crawl.maxPages`; note crawl is opt-in.
- `init` scaffold (`src/commands/init.ts`): same config shape.
- Discovery notes: mention the cap and that crawl is opt-in (no auto-fallback).

## Out of scope

- Per-source separate caps (one global cap governs both).
- Pushing `include`/`exclude` filtering into the sitemap fetch (filtering stays
  in `discoverPaths`; only the `keep` early-stop is shared with the crawler).
