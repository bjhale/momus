# Design: discovery.urlList — explicit URL/path list source

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Problem

Discovery today finds pages via sitemap (with an opt-in crawl fallback). Users
want to supply an **explicit list of pages** from a newline-delimited text file:
`discovery.urlList`. The file may contain full URLs or bare paths, mixed. It
should feed the same comparison pipeline as the other discovery sources.

## Decisions (from brainstorming)

1. **Merged source, seeding the crawl.** `urlList` (if enabled) unions with
   sitemap (if enabled) to form a page set. When crawl is enabled, that union is
   used as the **starting URLs for the crawl**, which expands it. When crawl is
   disabled, the union itself is the result. (This changes crawl from a
   "runs-only-when-sitemap-empty fallback" into a seeded expander — see §3.)
2. **Uniform pipeline; `maxPages` is a hard ceiling.** The whole set — including
   urlList entries — goes through the same `include`/`exclude` filter, dedup,
   `maxPages` cap, and sort. Nothing is exempt: a urlList of 502 entries with
   `maxPages: 500` yields 500 pages (2 dropped, in the usual first-N order).
3. **Full URLs must be under the prod base.** A full-URL line whose origin does
   not match the prod base is a **hard error** (exit 2), rather than being
   silently mis-targeted by the prod→dev base swap.

## Key insight: normalize everything to paths

Discovery returns **paths** (`string[]`); the pipeline joins each path onto the
dev and prod base (`new URL(path, config.dev)` / `new URL(path, config.prod)`).
So a full URL under the prod base is just "prod base + path". Normalizing each
urlList line to a path lets it flow through the existing pipeline unchanged, and
the user-described "string-replace prod→dev" becomes **emergent**: a full URL
becomes its path, and `new URL(path, config.dev)` yields exactly the base-swapped
dev URL while `new URL(path, config.prod)` reconstructs the prod URL.

## 1. Config

```ts
discovery: {
  urlList: "urls.txt",   // NEW — optional path to a newline-delimited URL/path file
  sitemap: true,
  maxPages: 500,
  crawl: false,
  include: ["/**"],
  exclude: ["/admin/**"],
}
```

- Schema: `urlList: z.string().optional()`. Unset → behavior unchanged.
- The file path is resolved relative to the working directory (same convention as
  the config file / `output.db`).

## 2. Parsing — `src/discovery/urllist.ts`

A pure, unit-tested function:

```ts
export function parseUrlList(content: string, prodBase: string): string[]
```

Per line (in file order):

- **Trim whitespace; skip blank lines.**
- **Full URL** (matches `/^https?:\/\//i`):
  - Normalize the prod base by stripping a trailing slash (`pb = prodBase.replace(/\/$/, "")`).
  - If the line equals `pb` or starts with `pb + "/"` → path = the remainder
    after `pb` (empty → `"/"`), with any `#fragment` stripped. Query string kept.
  - Otherwise → **throw** `Error("urlList entry not under prod base " + prodBase + ": " + line)`.
- **Path** (not a full URL): ensure a leading `/` (prepend if missing), strip any
  `#fragment`. Used as-is.

Returns the list of normalized paths (file order preserved; dedup happens later
in `discoverPaths`).

## 3. Merge + seeded crawl in `discoverPaths`

`urlList` (if set) and sitemap (if enabled) union into a **seed set** (urlList
first, so its explicit entries win dedup precedence and the `maxPages` budget).
When crawl is enabled, that seed set becomes the crawl's starting URLs; the crawl
output is then the discovery result. When crawl is disabled, the seed set is the
result directly.

```
seeds = []
if urlList set:  seeds = seeds.concat(parseUrlList(await readUrlList(urlListPath), base))
if sitemap:      seeds = seeds.concat(await sitemapFn(base, fetcher))

let raw
if (crawl.enabled) {
  const starts = seeds.length > 0 ? seeds : [crawl.startPath]   // fall back to startPath if no seeds
  raw = await crawlFn(base, starts, { maxDepth: crawl.maxDepth, maxPages }, fetcher, keep)
} else {
  raw = seeds
}

// unchanged uniform pipeline:
kept    = raw.filter(keep)                 // include/exclude
deduped = [...new Set(kept)]               // first-seen order preserved
capped  = maxPages === 0 ? deduped : deduped.slice(0, maxPages)
sorted  = capped.sort()
if (sorted.length === 0) throw "no pages discovered"
```

- **Ordering:** urlList seeds first, then sitemap seeds. The crawler processes
  seeds at depth 0 in that order, so with a full seed list at the cap it collects
  the first N seeds before expanding (matching decision 2's 502→500 example).
- **Crawl is now a seeded expander, not a fallback.** When enabled it always runs
  (seeded by urlList∪sitemap, or `crawl.startPath` when there are no seeds).
  **Behavior change:** previously, crawl-enabled + a non-empty sitemap meant crawl
  did *not* run; now it runs, seeded by the sitemap. Crawl remains opt-in
  (default disabled), so this only affects configs that already enabled it.
- Because seeded crawl fetches its seed pages, a seed that fails to load (or is
  excluded by `keep`) is not collected — the same rule the crawler already
  applies to every page. (With crawl disabled, seeds are not fetched during
  discovery; unreachable ones surface later as error comparisons.)
- The filter/dedup/cap/sort and the `"no pages discovered"` throw are unchanged.

### Crawler signature change

`crawlPaths` takes multiple start paths instead of one, so it can seed from the
union:

```ts
// before: crawlPaths(base, startPath: string, opts, fetcher, keep)
// after:  crawlPaths(base, startPaths: string[], opts, fetcher, keep)
```

The BFS queue is initialized with every start path at depth 0 (deduped by the
existing `visited` set); everything else — `keep` counting, `maxPages` (0 =
unlimited), `maxDepth`, same-host filter, fragment stripping — is unchanged.

`DiscoverArgs` gains:

- `urlList?: string` — the file path (undefined = source off).
- `_readUrlList?: (path: string) => Promise<string>` — injectable reader seam,
  defaulting to `(p) => Bun.file(p).text()`, mirroring `_sitemapFn`/`_crawlFn`.

The `_crawlFn` seam signature updates to `(base, starts: string[], opts, fetcher,
keep) => Promise<string[]>`. Parsing stays the pure `parseUrlList` (no
filesystem); the reader seam keeps `discoverPaths` testable without touching disk.

## 4. Command wiring

Both `discoverPaths({ ... })` call sites — the `discover` closure in
`src/commands/run.ts` and `src/commands/snapshot.ts` — pass
`urlList: config.discovery.urlList`. The default `_readUrlList` (real `Bun.file`)
is used in production; discovery runs against `config.prod`, so `base` (the prod
URL) is what `parseUrlList` checks full URLs against.

## 5. Edge cases

- **Missing file** → `Bun.file(path).text()` rejects (ENOENT) → propagates out of
  `discoverPaths` → the command's discovery catch → exit 2 with the error message.
- **Empty file / all-blank** → contributes no paths; if the total merged
  discovery is empty, the existing `"no pages discovered"` throw fires.
- **Off-base full URL** → hard error from `parseUrlList` (§2) → exit 2.
- **Fragments** (`#...`) stripped (consistent with the crawler); query strings kept.
- **Duplicate entries / overlap with sitemap** → deduped by the existing `Set`
  step (urlList's first-seen position wins).
- **No CLI flag** for `urlList` in this iteration (config only) — YAGNI.

## 6. Testing

- **`parseUrlList` (pure)**:
  - full URL under prod base → correct path; `https://prod` (bare) → `/`.
  - bare path `/pricing` → `/pricing`; `pricing` (no slash) → `/pricing`.
  - blank/whitespace-only lines skipped.
  - `#fragment` stripped; `?query` kept.
  - off-base full URL (different host) → throws naming the offending line.
  - prod base with a trailing slash handled (normalized).
- **`crawlPaths`** (multi-seed): initializes BFS from all start paths at depth 0;
  overlapping seeds deduped by `visited`; existing keep/maxPages/maxDepth tests
  updated to the `startPaths: string[]` signature (a single seed becomes `["/"]`).
- **`discoverPaths`**:
  - urlList merges with sitemap (union + dedup across an overlapping entry).
  - urlList entries are subject to include/exclude (an excluded urlList path is dropped).
  - urlList entries count toward `maxPages` (502 seeds, cap 500 → 500 pages); urlList-first ordering feeds the cap.
  - crawl enabled seeds from urlList∪sitemap (assert the seed set is passed as the
    crawler's `starts`); crawl enabled with no seeds falls back to `[crawl.startPath]`.
  - crawl disabled → result is the urlList∪sitemap union.
  - `_readUrlList` seam is invoked with the configured path; a rejecting reader
    (missing file) propagates.
- **Commands**: both `run` and `snapshot` pass `urlList` into `discoverPaths`
  (covered where those wirings are exercised).

## 7. Docs

- README config example: add `urlList` to the `discovery` block; a note describing
  the file format (newline-delimited; full URLs must be under the prod base; paths
  allowed; merged with sitemap; subject to include/exclude and `maxPages`).
- README discovery note: update the crawl description — crawl now **seeds from the
  urlList∪sitemap union** and runs whenever enabled (no longer "only as a fallback
  when the sitemap is empty"); it falls back to `crawl.startPath` when there are no
  seeds.
- `init` scaffold (`src/commands/init.ts`): add a commented `// urlList: "urls.txt",`
  line so the option is discoverable without enabling it.

## Out of scope

- A CLI `--url-list` flag (config only for now).
- Full URLs on a different host than prod (explicitly a hard error, not supported).
- Per-entry dev-URL overrides (the dev URL is always derived by base-swap).
