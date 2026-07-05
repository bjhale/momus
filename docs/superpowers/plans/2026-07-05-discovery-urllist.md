# discovery.urlList Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `discovery.urlList` — a newline-delimited file of full URLs or paths — as a discovery source that unions with the sitemap, seeds the crawl when enabled, and flows through the existing filter/dedup/cap/sort pipeline.

**Architecture:** A pure `parseUrlList` normalizes each line to a path (full URLs must be under the prod base, else hard error). `crawlPaths` takes multiple start paths so it can seed from the urlList∪sitemap union. `discoverPaths` builds the seed set (urlList first, then sitemap), uses it to seed the crawl when enabled (falling back to `crawl.startPath`), and otherwise returns the union — always through the existing filter → dedup → cap → sort.

**Tech Stack:** Bun, TypeScript, Zod, `bun:test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- Discovery returns **paths** (`string[]`); the pipeline joins each onto dev/prod via `new URL(path, base)`. urlList entries normalize to paths so "string-replace prod→dev" is emergent.
- **Full URLs must be under the prod base**; an off-base full URL is a **hard error** (message: `urlList entry not under prod base <prodBase>: <line>`).
- **Uniform pipeline / hard ceiling:** urlList entries are subject to `include`/`exclude` and `maxPages` (0 = unlimited). 502 entries with cap 500 → 500 kept.
- **Seed order:** urlList entries first, then sitemap.
- **Seeded crawl:** when `crawl.enabled`, crawl starts from the urlList∪sitemap union (or `[crawl.startPath]` when there are no seeds) and always runs; it is no longer a sitemap-empty fallback. Crawl stays opt-in (default disabled).
- `crawlPaths` becomes `(base, startPaths: string[], opts, fetcher, keep?)`; the `_crawlFn` seam matches.
- Blank/whitespace-only lines skipped; `#fragment` stripped; query string kept.
- The existing `"no pages discovered"` throw and the crawler's keep/maxPages/maxDepth/same-host behavior are unchanged.
- Commit after each task.

---

## File Structure

- `src/discovery/urllist.ts` — **create**: pure `parseUrlList(content, prodBase): string[]`.
- `src/discovery/crawler.ts` — **modify**: `startPath: string` → `startPaths: string[]` (queue seeded from all).
- `src/discovery/discover.ts` — **modify**: `DiscoverArgs` gets `urlList?`, `_readUrlList?`, updated `_crawlFn`; seeded merge; call `parseUrlList`.
- `src/config/schema.ts` — **modify**: add `discovery.urlList: z.string().optional()`.
- `src/commands/run.ts`, `src/commands/snapshot.ts` — **modify**: pass `urlList`; remove the `--crawl` sitemap hack.
- `src/commands/init.ts`, `README.md` — **modify**: document `urlList` + the seeded-crawl note.
- Tests: `tests/discovery/urllist.test.ts` (new), `tests/discovery/crawler.test.ts`, `tests/discovery/discover.test.ts`, `tests/config/schema.test.ts`.

---

## Task 1: `parseUrlList` pure parser

**Files:**
- Create: `src/discovery/urllist.ts`
- Test: `tests/discovery/urllist.test.ts`

**Interfaces:**
- Produces: `parseUrlList(content: string, prodBase: string): string[]` — normalizes each non-blank line to a path; full URLs must be under `prodBase` (else throws); fragments stripped, query kept.

- [ ] **Step 1: Write the failing tests**

Create `tests/discovery/urllist.test.ts`:

```typescript
// tests/discovery/urllist.test.ts
import { test, expect } from "bun:test";
import { parseUrlList } from "../../src/discovery/urllist";

const PROD = "https://www.example.com";

test("full URL under prod base becomes a path", () => {
  expect(parseUrlList("https://www.example.com/pricing", PROD)).toEqual(["/pricing"]);
});

test("bare prod base URL becomes root", () => {
  expect(parseUrlList("https://www.example.com", PROD)).toEqual(["/"]);
});

test("path lines are used as-is; missing leading slash is added", () => {
  expect(parseUrlList("/pricing\nabout", PROD)).toEqual(["/pricing", "/about"]);
});

test("blank and whitespace-only lines are skipped", () => {
  expect(parseUrlList("/a\n\n   \n/b", PROD)).toEqual(["/a", "/b"]);
});

test("fragments stripped, query kept", () => {
  expect(parseUrlList("https://www.example.com/docs?v=2#install\n/x#top", PROD))
    .toEqual(["/docs?v=2", "/x"]);
});

test("mixed full URLs and paths in one file", () => {
  expect(parseUrlList("https://www.example.com/a\n/b", PROD)).toEqual(["/a", "/b"]);
});

test("off-base full URL throws naming the offending line", () => {
  expect(() => parseUrlList("https://staging.acme.com/x", PROD))
    .toThrow(/not under prod base .*staging\.acme\.com\/x/);
});

test("false-prefix host is rejected as off-base", () => {
  expect(() => parseUrlList("https://www.example.com.evil.com/x", PROD))
    .toThrow(/not under prod base/);
});

test("trailing slash on prod base is normalized", () => {
  expect(parseUrlList("https://www.example.com/pricing", "https://www.example.com/"))
    .toEqual(["/pricing"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/discovery/urllist.test.ts`
Expected: FAIL — `parseUrlList` is not defined.

- [ ] **Step 3: Implement `src/discovery/urllist.ts`**

```typescript
// src/discovery/urllist.ts

/** Parse a newline-delimited URL/path list into paths for the discovery
 * pipeline. Each non-blank line becomes a path: a full URL (http/https) must be
 * under `prodBase` — else it throws — and is reduced to the part after the base;
 * a bare path is used as-is with a leading slash ensured. Fragments (`#...`) are
 * stripped; query strings are kept. Line order is preserved (dedup happens in
 * discoverPaths). */
export function parseUrlList(content: string, prodBase: string): string[] {
  const pb = prodBase.replace(/\/+$/, ""); // ignore trailing slash(es) on the base
  const out: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    let path: string;
    if (/^https?:\/\//i.test(line)) {
      // Full URL: must start with the prod base, and the next char must be a
      // path/query/fragment boundary (so "https://a.com" doesn't match
      // "https://a.com.evil/…").
      const rest = line.startsWith(pb) ? line.slice(pb.length) : null;
      if (rest === null || !(rest === "" || rest[0] === "/" || rest[0] === "?" || rest[0] === "#")) {
        throw new Error(`urlList entry not under prod base ${prodBase}: ${line}`);
      }
      path = rest === "" ? "/" : rest[0] === "/" ? rest : "/" + rest;
    } else {
      path = line[0] === "/" ? line : "/" + line;
    }

    const hash = path.indexOf("#");
    if (hash !== -1) path = path.slice(0, hash);
    if (path === "") path = "/";
    out.push(path);
  }

  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/discovery/urllist.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/discovery/urllist.ts tests/discovery/urllist.test.ts
git commit -m "feat: add parseUrlList — normalize a URL/path list to paths"
```

---

## Task 2: Multi-seed crawler + seeded-merge `discoverPaths`

**Files:**
- Modify: `src/discovery/crawler.ts`, `src/discovery/discover.ts`
- Test: `tests/discovery/crawler.test.ts`, `tests/discovery/discover.test.ts`

**Interfaces:**
- Consumes: `parseUrlList` (Task 1); `matchPath`; `fetchSitemapPaths`, `Fetcher`.
- Produces:
  - `crawlPaths(base: string, startPaths: string[], opts: CrawlOptions, fetcher: Fetcher, keep?: (path: string) => boolean): Promise<string[]>` — BFS seeded from every start path.
  - `DiscoverArgs` = `{ base; urlList?: string; sitemap: boolean; maxPages: number; crawl: { enabled; startPath; maxDepth }; include: string[]; exclude: string[]; fetcher: Fetcher; _sitemapFn?; _crawlFn?: (base, starts: string[], opts, fetcher, keep) => Promise<string[]>; _readUrlList?: (path: string) => Promise<string> }`.

- [ ] **Step 1: Rewrite the crawler test to the multi-seed signature**

Replace the contents of `tests/discovery/crawler.test.ts` with (every `crawlPaths(base, "/", ...)` becomes `crawlPaths(base, ["/"], ...)`, plus two new seed tests):

```typescript
// tests/discovery/crawler.test.ts
import { test, expect } from "bun:test";
import { crawlPaths } from "../../src/discovery/crawler";
import type { Fetcher } from "../../src/discovery/sitemap";

function html(links: string[]): string {
  return `<html><body>${links.map((h) => `<a href="${h}">x</a>`).join("")}</body></html>`;
}

function fakeFetch(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

test("BFS discovers same-domain links up to depth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "https://other.com/x"]),
    "https://www.example.com/a": html(["/c"]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 100 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b", "/c"]);
});

test("keeps links with fragments, stripping the fragment but keeping the query", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/docs?v=2#install"]),
    "https://www.example.com/docs?v=2": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 100 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/docs?v=2"]);
});

test("respects maxPages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 2 }, fetcher);
  expect(paths.length).toBe(2);
});

test("keep excludes pages from results but still traverses through them", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/skip"]),
    "https://www.example.com/skip": html(["/keep"]),
    "https://www.example.com/keep": html([]),
  });
  const keep = (p: string) => p !== "/skip";
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 0 }, fetcher, keep);
  expect(paths.sort()).toEqual(["/", "/keep"]);
});

test("maxPages counts only kept pages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c", "/d"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
    "https://www.example.com/d": html([]),
  });
  const keep = (p: string) => p !== "/a" && p !== "/b";
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 2 }, fetcher, keep);
  expect(paths).toEqual(["/", "/c"]);
});

test("maxPages 0 crawls unlimited, bounded only by maxDepth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a"]),
    "https://www.example.com/a": html(["/b"]),
    "https://www.example.com/b": html(["/c"]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 0 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b"]);
});

test("seeds BFS from every start path", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html(["/c"]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/a", "/b"], { maxDepth: 2, maxPages: 0 }, fetcher);
  expect(paths.sort()).toEqual(["/a", "/b", "/c"]);
});

test("deduplicates overlapping start paths", async () => {
  const fetcher = fakeFetch({ "https://www.example.com/a": html([]) });
  const paths = await crawlPaths("https://www.example.com", ["/a", "/a"], { maxDepth: 1, maxPages: 0 }, fetcher);
  expect(paths).toEqual(["/a"]);
});
```

- [ ] **Step 2: Run to verify the crawler test fails**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: FAIL — `crawlPaths` still expects a single `startPath` string; passing `["/"]` breaks the queue seed.

- [ ] **Step 3: Update `src/discovery/crawler.ts` to multi-seed**

Change the signature and the queue initialization (only those two spots change). Replace the `crawlPaths` signature line and the `const queue = ...` line:

Signature — replace `startPath: string,` with `startPaths: string[],`:

```typescript
export async function crawlPaths(
  base: string,
  startPaths: string[],
  opts: CrawlOptions,
  fetcher: Fetcher,
  keep: (path: string) => boolean = () => true,
): Promise<string[]> {
```

Queue init — replace `const queue: Array<{ path: string; depth: number }> = [{ path: startPath, depth: 0 }];` with:

```typescript
  const queue: Array<{ path: string; depth: number }> = startPaths.map((p) => ({ path: p, depth: 0 }));
```

Also update the doc comment's first line to reflect multiple seeds:

```typescript
/** Same-domain breadth-first crawl seeded from every path in `startPaths`.
 * Returns discovered paths that pass `keep`, in BFS order, up to `maxPages`
 * (0 = unlimited). Pages that fail `keep` are still fetched and traversed — so
 * links to kept pages behind an excluded page are still followed — but are not
 * collected or counted toward the cap. */
```

- [ ] **Step 4: Run the crawler test to verify it passes**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: PASS (8 tests). (`discover.ts` will not compile yet — it still calls `crawlPaths` with a single string; the next steps fix that.)

- [ ] **Step 5: Rewrite the discover test for seeded-merge + urlList**

Replace the contents of `tests/discovery/discover.test.ts` with:

```typescript
// tests/discovery/discover.test.ts
import { test, expect } from "bun:test";
import { discoverPaths } from "../../src/discovery/discover";
import type { Fetcher } from "../../src/discovery/sitemap";

const fetcher: Fetcher = async () => ({ ok: false, status: 404, text: async () => "" });

test("filters via include/exclude and dedupes/sorts (crawl off)", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/admin/**"], fetcher,
    _sitemapFn: async () => ["/pricing", "/", "/admin/secret", "/"],
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("crawl off: result is the urlList ∪ sitemap union, deduped", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", urlList: "urls.txt", sitemap: true, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _readUrlList: async () => "/a\nhttps://www.example.com/b",
    _sitemapFn: async () => ["/b", "/c"], // /b overlaps → deduped
  });
  expect(paths).toEqual(["/a", "/b", "/c"]);
});

test("urlList entries are subject to include/exclude", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", urlList: "urls.txt", sitemap: false, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/admin/**"], fetcher,
    _readUrlList: async () => "/a\n/admin/secret\n/b",
  });
  expect(paths).toEqual(["/a", "/b"]);
});

test("urlList entries count toward maxPages (first-N in file order)", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", urlList: "urls.txt", sitemap: false, maxPages: 2,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _readUrlList: async () => "/z\n/m\n/a", // 3 entries, cap 2
  });
  expect(paths).toEqual(["/m", "/z"]); // first 2 in file order, then sorted
});

test("_readUrlList is called with the configured path", async () => {
  let seen: string | undefined;
  await discoverPaths({
    base: "https://www.example.com", urlList: "my-urls.txt", sitemap: false, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _readUrlList: async (p) => { seen = p; return "/a"; },
  });
  expect(seen).toBe("my-urls.txt");
});

test("a rejecting urlList reader (missing file) propagates", async () => {
  await expect(discoverPaths({
    base: "https://www.example.com", urlList: "missing.txt", sitemap: false, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _readUrlList: async () => { throw new Error("ENOENT: missing.txt"); },
  })).rejects.toThrow(/ENOENT/);
});

test("wires the real fetchSitemapPaths when no seams are injected (crawl off)", async () => {
  const xml = await Bun.file("tests/fixtures/sitemap-flat.xml").text();
  const wiredFetcher: Fetcher = async (url: string) => {
    if (url === "https://www.example.com/sitemap.xml") {
      return { ok: true, status: 200, text: async () => xml };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/about"], fetcher: wiredFetcher,
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("throws when no pages discovered", async () => {
  await expect(discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 500,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _sitemapFn: async () => [],
  })).rejects.toThrow(/no pages discovered/i);
});

test("caps to the first N pages in discovery order, not alphabetical", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 2,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _sitemapFn: async () => ["/z", "/m", "/a", "/b"],
  });
  expect(paths).toEqual(["/m", "/z"]);
});

test("cap is applied AFTER include/exclude", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 2,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/admin/**"], fetcher,
    _sitemapFn: async () => ["/admin/x", "/a", "/admin/y", "/b", "/c"],
  });
  expect(paths).toEqual(["/a", "/b"]);
});

test("maxPages 0 means unlimited", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 0,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _sitemapFn: async () => ["/a", "/b", "/c", "/d", "/e"],
  });
  expect(paths).toEqual(["/a", "/b", "/c", "/d", "/e"]);
});

test("crawl enabled seeds from the urlList ∪ sitemap union (urlList first)", async () => {
  let seenStarts: string[] | undefined;
  const paths = await discoverPaths({
    base: "https://www.example.com", urlList: "urls.txt", sitemap: true, maxPages: 500,
    crawl: { enabled: true, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _readUrlList: async () => "/a",
    _sitemapFn: async () => ["/b"],
    _crawlFn: async (_base, starts) => { seenStarts = starts; return [...starts, "/discovered"]; },
  });
  expect(seenStarts).toEqual(["/a", "/b"]);
  expect(paths).toEqual(["/a", "/b", "/discovered"]);
});

test("crawl enabled with no seeds falls back to [startPath]; cap+keep threaded", async () => {
  let seenStarts: string[] | undefined;
  let receivedMaxPages: number | undefined;
  let keepSkip: boolean | undefined;
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 3,
    crawl: { enabled: true, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/skip"], fetcher,
    _sitemapFn: async () => [], // no seeds
    _crawlFn: async (_base, starts, opts, _f, keep) => {
      seenStarts = starts; receivedMaxPages = opts.maxPages; keepSkip = keep("/skip");
      return ["/", "/a", "/b", "/c", "/d"];
    },
  });
  expect(seenStarts).toEqual(["/"]);
  expect(receivedMaxPages).toBe(3);
  expect(keepSkip).toBe(false);
  expect(paths).toEqual(["/", "/a", "/b"]);
});
```

- [ ] **Step 6: Run to verify the discover test fails**

Run: `bun test tests/discovery/discover.test.ts`
Expected: FAIL — `DiscoverArgs` has no `urlList`/`_readUrlList`; crawl is still a fallback (only runs when sitemap empty), so the seeded-crawl tests fail.

- [ ] **Step 7: Rewrite `src/discovery/discover.ts`**

```typescript
// src/discovery/discover.ts
import { matchPath } from "../glob";
import { fetchSitemapPaths, type Fetcher } from "./sitemap";
import { crawlPaths, type CrawlOptions } from "./crawler";
import { parseUrlList } from "./urllist";

export interface DiscoverArgs {
  base: string;
  /** Optional path to a newline-delimited URL/path file (undefined = source off). */
  urlList?: string;
  sitemap: boolean;
  /** Cap on the final page count; 0 = unlimited. Applies across all sources. */
  maxPages: number;
  crawl: { enabled: boolean; startPath: string; maxDepth: number };
  include: string[];
  exclude: string[];
  fetcher: Fetcher;
  // Injectable seams for tests; default to the real implementations.
  _sitemapFn?: (base: string, fetcher: Fetcher) => Promise<string[]>;
  _crawlFn?: (base: string, starts: string[], opts: CrawlOptions, fetcher: Fetcher,
              keep: (path: string) => boolean) => Promise<string[]>;
  _readUrlList?: (path: string) => Promise<string>;
}

/** Discovery source of truth is the given base (prod). urlList (if set) and
 * sitemap (if enabled) union into a seed set (urlList first). When crawl is
 * enabled it expands from those seeds (or crawl.startPath when there are none);
 * otherwise the seed set is the result. Everything then flows through the same
 * filter → dedup → cap → sort. Returns the first `maxPages` survivors in
 * discovery order, sorted. */
export async function discoverPaths(args: DiscoverArgs): Promise<string[]> {
  const sitemapFn = args._sitemapFn ?? fetchSitemapPaths;
  const crawlFn = args._crawlFn ?? crawlPaths;
  const readUrlList = args._readUrlList ?? ((p: string) => Bun.file(p).text());
  const keep = (p: string) =>
    args.include.some((g) => matchPath(p, g)) &&
    !args.exclude.some((g) => matchPath(p, g));

  // Seed set: urlList entries first (explicit → win dedup + the maxPages budget),
  // then sitemap.
  let seeds: string[] = [];
  if (args.urlList) {
    seeds = seeds.concat(parseUrlList(await readUrlList(args.urlList), args.base));
  }
  if (args.sitemap) {
    seeds = seeds.concat(await sitemapFn(args.base, args.fetcher));
  }

  // Crawl (when enabled) is a seeded expander over the union — or crawl.startPath
  // when there are no seeds. When disabled, the seed set is the result directly.
  let raw: string[];
  if (args.crawl.enabled) {
    const starts = seeds.length > 0 ? seeds : [args.crawl.startPath];
    raw = await crawlFn(args.base, starts,
      { maxDepth: args.crawl.maxDepth, maxPages: args.maxPages }, args.fetcher, keep);
  } else {
    raw = seeds;
  }

  // Uniform pipeline: filter → dedup (first-seen order) → cap → sort.
  // 0 = unlimited. Authoritative filter for the seed sources; idempotent for the
  // crawl branch (the crawler already applied `keep`).
  const kept = raw.filter(keep);
  const deduped = [...new Set(kept)]; // Set preserves first-seen order
  const capped = args.maxPages === 0 ? deduped : deduped.slice(0, args.maxPages);
  const sorted = capped.sort();
  if (sorted.length === 0) throw new Error("no pages discovered");
  return sorted;
}
```

- [ ] **Step 8: Run the discover test to verify it passes**

Run: `bun test tests/discovery/discover.test.ts`
Expected: PASS.

- [ ] **Step 9: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors. (The commands still compile — `discoverPaths` is called without `urlList`, which is optional, and the `crawl` object is unchanged; the `--crawl` sitemap hack is still present and harmless until Task 3.)

- [ ] **Step 10: Commit**

```bash
git add src/discovery/crawler.ts src/discovery/discover.ts tests/discovery/crawler.test.ts tests/discovery/discover.test.ts
git commit -m "feat: seed the crawl from urlList∪sitemap; add urlList discovery source"
```

---

## Task 3: Config schema + command wiring

**Files:**
- Modify: `src/config/schema.ts`, `src/commands/run.ts`, `src/commands/snapshot.ts`
- Test: `tests/config/schema.test.ts`

**Interfaces:**
- Consumes: `ResolvedConfig.discovery.urlList` (this task adds it); `discoverPaths`'s `urlList` arg (Task 2).
- Produces: `ResolvedConfig.discovery.urlList?: string`.

- [ ] **Step 1: Write the failing schema test**

Append to `tests/config/schema.test.ts`:

```typescript
test("discovery.urlList is optional and passes through", () => {
  const withList = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { urlList: "urls.txt" } });
  expect(withList.discovery.urlList).toBe("urls.txt");
  const without = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(without.discovery.urlList).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — `urlList` is stripped (unknown key) so `withList.discovery.urlList` is undefined, not `"urls.txt"`.

- [ ] **Step 3: Add `urlList` to the schema**

In `src/config/schema.ts`, add `urlList` as the first field inside the `discovery: z.object({ ... })`:

```typescript
    urlList: z.string().optional(),
```

(Place it just before the `sitemap:` line.)

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `urlList` through both commands and remove the `--crawl` sitemap hack**

In `src/commands/run.ts`, in the `discoverPaths({ ... })` call inside the `discover` closure, add the `urlList` field and change the `sitemap` line (drop the `--crawl` workaround). The block becomes:

```typescript
      discover: () => discoverPaths({
        base: config.prod,
        urlList: config.discovery.urlList,
        maxPages: config.discovery.maxPages,
        sitemap: config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
```

(Remove the two-line `// \`--crawl\` forces a link crawl …` comment along with the `parsed.overrides.crawl ? false :` expression.)

Apply the **identical** change to the `discoverPaths({ ... })` call in `src/commands/snapshot.ts` (add `urlList: config.discovery.urlList`; change `sitemap:` to `config.discovery.sitemap`; drop the comment).

- [ ] **Step 6: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS; no type errors. (`--crawl` still forces crawl on via `resolveConfig`; the CLI/load tests are unaffected.)

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/commands/run.ts src/commands/snapshot.ts tests/config/schema.test.ts
git commit -m "feat: wire discovery.urlList through config + commands; drop --crawl sitemap hack"
```

---

## Task 4: Docs + init scaffold

**Files:**
- Modify: `src/commands/init.ts`, `README.md`

**Interfaces:** none (docs/scaffold only).

- [ ] **Step 1: Update the `init` scaffold**

In `src/commands/init.ts`, add a commented `urlList` line as the first entry inside the `discovery: {` block of the `configScaffold()` template string:

```typescript
  discovery: {
    // urlList: "urls.txt",   // optional: newline-delimited full URLs or paths
    sitemap: true,
    maxPages: 500,
    crawl: false,
    include: ["/**"],
    exclude: ["/admin/**"],
  },
```

- [ ] **Step 2: Update the README config example**

In `README.md`, add the commented `urlList` line as the first entry in the `discovery: { ... }` config example block:

```markdown
  discovery: {
    // urlList: "urls.txt",                                  // optional: newline-delimited full URLs or paths
    sitemap: true,                                            // read /sitemap.xml
    maxPages: 500,                                            // cap total pages (0 = unlimited)
    crawl: false,                                             // false | true | { startPath, maxDepth }
    include: ["/**"],                                         // path globs to keep
    exclude: ["/admin/**"],                                   // path globs to drop
  },
```

- [ ] **Step 3: Update the Discovery note**

In `README.md`, replace the `- **Discovery** runs against \`prod\` …` note (the bullet under the config "Notes:" list) with:

```markdown
- **Discovery** runs against `prod` (the baseline is the source of truth for
  which pages exist). Pages come from an optional `urlList` file and/or the
  `sitemap`, unioned together. **`urlList`** is a newline-delimited file of full
  URLs or bare paths (blank lines ignored); a full URL must be under the `prod`
  base URL (it is reduced to its path — the dev URL is the same path on the `dev`
  base), otherwise the run fails. **Crawling is opt-in** — set `crawl: true` (or a
  `crawl: { … }` object); when enabled it **seeds from the urlList∪sitemap union**
  (or `crawl.startPath` when those are empty) and expands via same-origin links.
  `maxPages` caps the total pages compared — the first N that survive
  `include`/`exclude`, in discovery order — across every source (`0` = no cap).
  Override per run with `--max-pages N`.
```

- [ ] **Step 4: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS (docs/scaffold change touches no asserted runtime behavior).

```bash
git add src/commands/init.ts README.md
git commit -m "docs: document discovery.urlList and seeded crawl"
```

---

## Self-Review

**1. Spec coverage:**
- §1 config (`discovery.urlList` optional) → Task 3 (schema). ✓
- §2 `parseUrlList` (normalize, under-prod-base or throw, blanks, fragments) → Task 1. ✓
- §3 seeded merge + crawler multi-seed (union seeds, urlList first, crawl seeds or startPath, uniform filter/cap/sort) → Task 2. ✓
- §4 command wiring (pass urlList; remove `--crawl` sitemap hack) → Task 3 (Step 5). ✓
- §5 edge cases (missing file propagates; empty → no-pages throw; off-base error; fragments; dedup) → Task 1 + Task 2 tests. ✓
- §6 testing (parseUrlList; multi-seed crawler; seeded/disabled/merge/cap discover) → Tasks 1–2. ✓
- §7 docs (README example + discovery note; init scaffold) → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code. ✓

**3. Type consistency:** `parseUrlList(content, prodBase): string[]` defined in Task 1, consumed by `discoverPaths` in Task 2. `crawlPaths(base, startPaths: string[], opts, fetcher, keep?)` (Task 2) matches the `_crawlFn` seam type and the command's default. `DiscoverArgs.urlList?: string` + `_readUrlList?` (Task 2) consumed by the commands (Task 3) and the schema field `discovery.urlList?: string` (Task 3). `CrawlOptions` unchanged `{ maxDepth, maxPages }`. ✓

**Note for the implementer:** Task 2 is the largest — after Step 3 (crawler signature change) the repo does not typecheck until Step 7 (discover.ts) lands, because `discover.ts` still calls the old single-seed signature. That is expected mid-task; run the full `bun test && bunx tsc --noEmit` gate at Step 9 before committing.
