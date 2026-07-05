# Global maxPages Cap + Opt-in Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `discovery.maxPages` cap (0 = unlimited, `--max-pages` CLI override) that limits the first N filter-surviving pages in discovery order across sitemap or crawl, and make `discovery.crawl` opt-in with a `true | false | object` shorthand (default disabled).

**Architecture:** The crawler gains a `keep` predicate so it counts only filter-surviving pages toward the cap while still traversing through excluded pages. `discoverPaths` moves `maxPages` to a top-level field, builds the shared `keep` predicate, and caps the first N survivors in discovery order (slice before the alphabetical sort). The config schema replaces `crawl.maxPages` with `discovery.maxPages` and turns `crawl` into a boolean-or-object union normalized to `{ enabled, startPath, maxDepth }`.

**Tech Stack:** Bun, TypeScript, Zod, `bun:test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- `discovery.maxPages`: `z.number().int().nonnegative().default(500)`; **0 = unlimited**.
- Cap counts pages **that survive `include`/`exclude`**, and keeps the **first N in discovery order** (sitemap doc order / crawl BFS order) — slice happens **before** the alphabetical output sort.
- The crawler counts only `keep`-passing pages toward `maxPages` but still **fetches and traverses through** excluded pages to reach kept ones; traversal stays bounded by `maxDepth`.
- `discovery.crawl` accepts `boolean | object`, **defaults to disabled**, normalized to `{ enabled: boolean, startPath: string, maxDepth: number }`. Object form's `enabled` defaults to `true`; `crawl: { enabled: false }` still disables (do not drop the `enabled` key).
- `discovery.crawl.maxPages` is **removed**; a legacy config still carrying it must parse without error.
- CLI: `--max-pages N` overrides `discovery.maxPages`; CLI wins over config.
- Existing discovery behavior otherwise unchanged: crawl remains a fallback that runs only when the raw sitemap is empty; the `"no pages discovered"` throw stays.
- Commit after each task.

---

## File Structure

- `src/discovery/crawler.ts` — **modify**: add `keep` predicate param; count only survivors; `maxPages: 0` = unlimited.
- `src/discovery/discover.ts` — **modify**: `DiscoverArgs` gets top-level `maxPages` (crawl loses `maxPages`); build shared `keep`; post-filter cap (slice before sort); pass `keep` to the crawler.
- `src/config/schema.ts` — **modify**: add `discovery.maxPages`; `crawl` boolean-or-object union (default disabled); remove `crawl.maxPages`.
- `src/config/load.ts` — **modify**: union-safe `--crawl` merge; add `--max-pages` merge + `CliOverrides.maxPages`.
- `src/cli.ts` — **modify**: parse `--max-pages`; help text.
- `src/commands/run.ts`, `src/commands/snapshot.ts` — **modify**: discovery wiring passes top-level `maxPages: config.discovery.maxPages`, crawl object without `maxPages`.
- `src/commands/init.ts` — **modify**: scaffold the new config shape.
- `README.md` — **modify**: config example, flag tables, discovery notes.
- Tests: `tests/discovery/crawler.test.ts`, `tests/discovery/discover.test.ts`, `tests/config/schema.test.ts`, `tests/config/load.test.ts`, `tests/cli.test.ts`.

---

## Task 1: Crawler — `keep` predicate + `maxPages: 0` unlimited

**Files:**
- Modify: `src/discovery/crawler.ts`
- Test: `tests/discovery/crawler.test.ts`

**Interfaces:**
- Produces: `crawlPaths(base: string, startPath: string, opts: CrawlOptions, fetcher: Fetcher, keep?: (path: string) => boolean): Promise<string[]>` — `keep` defaults to `() => true`. Returns `keep`-passing paths in BFS order, capped at `opts.maxPages` (`0` = unlimited). Non-`keep` pages are still fetched/traversed but not collected or counted. `CrawlOptions` stays `{ maxDepth: number; maxPages: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/discovery/crawler.test.ts`:

```typescript
test("keep excludes pages from results but still traverses through them", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/skip"]),
    "https://www.example.com/skip": html(["/keep"]), // excluded, but links to a kept page
    "https://www.example.com/keep": html([]),
  });
  const keep = (p: string) => p !== "/skip";
  const paths = await crawlPaths("https://www.example.com", "/", { maxDepth: 5, maxPages: 0 }, fetcher, keep);
  expect(paths.sort()).toEqual(["/", "/keep"]); // /skip fetched + traversed, not collected
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
  const paths = await crawlPaths("https://www.example.com", "/", { maxDepth: 5, maxPages: 2 }, fetcher, keep);
  // BFS: "/" kept(1); /a,/b skipped; /c kept(2) -> stop.
  expect(paths).toEqual(["/", "/c"]);
});

test("maxPages 0 crawls unlimited, bounded only by maxDepth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a"]),
    "https://www.example.com/a": html(["/b"]),
    "https://www.example.com/b": html(["/c"]), // depth 3, beyond maxDepth 2 → not traversed
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", "/", { maxDepth: 2, maxPages: 0 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: FAIL — `crawlPaths` does not accept a `keep` arg / does not treat `maxPages: 0` as unlimited (the 0 test loops zero times and returns `[]`).

- [ ] **Step 3: Rewrite `src/discovery/crawler.ts`**

Replace the file contents with:

```typescript
// src/discovery/crawler.ts
import type { Fetcher } from "./sitemap";

export interface CrawlOptions { maxDepth: number; maxPages: number }

function extractHrefs(html: string): string[] {
  // matchAll avoids stateful RegExp; group 1 is the href value. Capture the full
  // href (including any #fragment) so fragmented links aren't dropped; the URL
  // parser below strips the fragment via `abs.pathname + abs.search`.
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
}

/** Same-domain breadth-first crawl. Returns discovered paths (incl. start) that
 * pass `keep`, in BFS order, up to `maxPages` (0 = unlimited). Pages that fail
 * `keep` are still fetched and traversed — so links to kept pages behind an
 * excluded page are still followed — but are not collected or counted toward
 * the cap. */
export async function crawlPaths(
  base: string,
  startPath: string,
  opts: CrawlOptions,
  fetcher: Fetcher,
  keep: (path: string) => boolean = () => true,
): Promise<string[]> {
  const baseHost = new URL(base).host;
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: startPath, depth: 0 }];
  const capped = opts.maxPages > 0;

  while (queue.length > 0 && (!capped || result.length < opts.maxPages)) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const url = new URL(path, base).toString();
    const res = await fetcher(url);
    if (!res.ok) continue;

    // Only pages passing `keep` are collected and counted toward the cap.
    if (keep(path)) {
      result.push(path);
      if (capped && result.length >= opts.maxPages) break;
    }
    if (depth >= opts.maxDepth) continue;

    const body = await res.text();
    for (const href of extractHrefs(body)) {
      try {
        const abs = new URL(href, url);
        if (abs.host !== baseHost) continue;
        const childPath = abs.pathname + abs.search;
        if (!visited.has(childPath)) queue.push({ path: childPath, depth: depth + 1 });
      } catch { /* ignore malformed href */ }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: PASS — the three new tests plus the pre-existing ones ("BFS discovers…", "keeps links with fragments…", "respects maxPages") all green (existing tests pass `keep` implicitly as accept-all).

- [ ] **Step 5: Commit**

```bash
git add src/discovery/crawler.ts tests/discovery/crawler.test.ts
git commit -m "feat: crawler counts only keep-passing pages; maxPages 0 = unlimited"
```

---

## Task 2: Config reshape — `discovery.maxPages` + `crawl` union + `discoverPaths` cap

**Files:**
- Modify: `src/config/schema.ts`, `src/discovery/discover.ts`, `src/config/load.ts` (crawl-merge only), `src/commands/run.ts`, `src/commands/snapshot.ts`
- Test: `tests/config/schema.test.ts`, `tests/discovery/discover.test.ts`

**Interfaces:**
- Consumes: `crawlPaths` with the `keep` param (Task 1); `matchPath` (`src/glob`).
- Produces:
  - `ResolvedConfig.discovery` = `{ sitemap: boolean; maxPages: number; crawl: { enabled: boolean; startPath: string; maxDepth: number }; include: string[]; exclude: string[] }`.
  - `DiscoverArgs` = `{ base: string; sitemap: boolean; maxPages: number; crawl: { enabled: boolean; startPath: string; maxDepth: number }; include: string[]; exclude: string[]; fetcher: Fetcher; _sitemapFn?: ...; _crawlFn?: (base, start, opts, fetcher, keep) => Promise<string[]> }`.

- [ ] **Step 1: Write the failing schema tests**

Append to `tests/config/schema.test.ts`:

```typescript
test("discovery.maxPages defaults to 500 and rejects negatives", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.discovery.maxPages).toBe(500);
  expect(() => ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { maxPages: -1 } })).toThrow();
});

test("discovery.maxPages accepts 0 (unlimited)", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { maxPages: 0 } });
  expect(c.discovery.maxPages).toBe(0);
});

test("crawl defaults to disabled when omitted", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.discovery.crawl).toEqual({ enabled: false, startPath: "/", maxDepth: 3 });
});

test("crawl accepts boolean shorthands", () => {
  const off = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: false } });
  expect(off.discovery.crawl.enabled).toBe(false);
  const on = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: true } });
  expect(on.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 3 });
});

test("crawl object opts in and applies overrides; enabled:false still disables", () => {
  const obj = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { maxDepth: 5 } } });
  expect(obj.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 5 });
  const disabled = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { enabled: false, maxDepth: 5 } } });
  expect(disabled.discovery.crawl.enabled).toBe(false);
});

test("legacy crawl.maxPages is ignored without error", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { maxPages: 999 } as any } });
  expect(c.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 3 });
  expect((c.discovery.crawl as any).maxPages).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify the schema tests fail**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — `maxPages` is undefined; `crawl` doesn't accept booleans and still defaults enabled.

- [ ] **Step 3: Update `src/config/schema.ts` discovery block**

In `src/config/schema.ts`, replace the `discovery: z.object({...}).default({})` block with:

```typescript
  discovery: z.object({
    sitemap: z.boolean().default(true),
    maxPages: z.number().int().nonnegative().default(500), // 0 = unlimited
    crawl: z.union([
      z.boolean(),
      z.object({
        enabled: z.boolean().default(true), // an object means you opted in
        startPath: z.string().default("/"),
        maxDepth: z.number().int().positive().default(3),
      }),
    ]).default(false).transform((v) =>
      typeof v === "boolean"
        ? { enabled: v, startPath: "/", maxDepth: 3 }
        : v),
    include: z.array(z.string()).default(["/**"]),
    exclude: z.array(z.string()).default([]),
  }).default({}),
```

- [ ] **Step 4: Run the schema tests to verify they pass**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write/adjust the failing discover tests**

Replace the contents of `tests/discovery/discover.test.ts` with (updates existing calls to the new arg shape — top-level `maxPages`, crawl without `maxPages` — and adds cap tests):

```typescript
// tests/discovery/discover.test.ts
import { test, expect } from "bun:test";
import { discoverPaths } from "../../src/discovery/discover";
import type { Fetcher } from "../../src/discovery/sitemap";

const fetcher: Fetcher = async () => ({ ok: false, status: 404, text: async () => "" });

test("filters via include/exclude and dedupes/sorts", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 500,
    crawl: { enabled: true, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/admin/**"], fetcher,
    _sitemapFn: async () => ["/pricing", "/", "/admin/secret", "/"],
    _crawlFn: async () => { throw new Error("crawl must not run when sitemap is non-empty"); },
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("falls back to crawl when sitemap yields nothing", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 500,
    crawl: { enabled: true, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _sitemapFn: async () => [],
    _crawlFn: async () => ["/", "/a"],
  });
  expect(paths).toEqual(["/", "/a"]);
});

test("wires the real fetchSitemapPaths when no seams are injected", async () => {
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
    _crawlFn: async () => [],
  })).rejects.toThrow(/no pages discovered/i);
});

test("caps to the first N pages in discovery order, not alphabetical", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 2,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: [], fetcher,
    _sitemapFn: async () => ["/z", "/m", "/a", "/b"], // doc order
  });
  // First 2 in doc order are /z,/m → then sorted for display.
  expect(paths).toEqual(["/m", "/z"]);
});

test("cap is applied AFTER include/exclude", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 2,
    crawl: { enabled: false, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/admin/**"], fetcher,
    _sitemapFn: async () => ["/admin/x", "/a", "/admin/y", "/b", "/c"],
  });
  // exclude drops /admin/* → [/a,/b,/c]; first 2 → /a,/b → sorted.
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

test("passes the cap and keep predicate through to the crawl fallback", async () => {
  let receivedMaxPages: number | undefined;
  let keepSkip: boolean | undefined;
  const paths = await discoverPaths({
    base: "https://www.example.com", sitemap: true, maxPages: 3,
    crawl: { enabled: true, startPath: "/", maxDepth: 2 },
    include: ["/**"], exclude: ["/skip"], fetcher,
    _sitemapFn: async () => [],
    _crawlFn: async (_b, _s, opts, _f, keep) => {
      receivedMaxPages = opts.maxPages;
      keepSkip = keep("/skip");
      return ["/", "/a", "/b", "/c", "/d"];
    },
  });
  expect(receivedMaxPages).toBe(3);   // global cap threaded into the crawl
  expect(keepSkip).toBe(false);        // keep predicate reflects exclude
  expect(paths).toEqual(["/", "/a", "/b"]); // discover also caps defensively
});
```

- [ ] **Step 6: Run to verify the discover tests fail**

Run: `bun test tests/discovery/discover.test.ts`
Expected: FAIL — `DiscoverArgs` still expects `crawl.maxPages` / lacks top-level `maxPages`; the cap tests fail.

- [ ] **Step 7: Rewrite `src/discovery/discover.ts`**

Replace the file contents with:

```typescript
// src/discovery/discover.ts
import { matchPath } from "../glob";
import { fetchSitemapPaths, type Fetcher } from "./sitemap";
import { crawlPaths, type CrawlOptions } from "./crawler";

export interface DiscoverArgs {
  base: string;
  sitemap: boolean;
  /** Cap on the final page count; 0 = unlimited. Applies to sitemap OR crawl. */
  maxPages: number;
  crawl: { enabled: boolean; startPath: string; maxDepth: number };
  include: string[];
  exclude: string[];
  fetcher: Fetcher;
  // Injectable seams for tests; default to the real implementations.
  _sitemapFn?: (base: string, fetcher: Fetcher) => Promise<string[]>;
  _crawlFn?: (base: string, start: string, opts: CrawlOptions, fetcher: Fetcher,
              keep: (path: string) => boolean) => Promise<string[]>;
}

/** Discovery source of truth is the given base (prod). Returns the first
 * `maxPages` paths (in discovery order) that survive include/exclude, sorted. */
export async function discoverPaths(args: DiscoverArgs): Promise<string[]> {
  const sitemapFn = args._sitemapFn ?? fetchSitemapPaths;
  const crawlFn = args._crawlFn ?? crawlPaths;
  const keep = (p: string) =>
    args.include.some((g) => matchPath(p, g)) &&
    !args.exclude.some((g) => matchPath(p, g));

  let paths: string[] = [];
  if (args.sitemap) {
    paths = await sitemapFn(args.base, args.fetcher);
  }
  // The crawl fallback triggers only when the RAW sitemap result is empty
  // (measured BEFORE filtering). A non-empty sitemap is authoritative.
  if (paths.length === 0 && args.crawl.enabled) {
    paths = await crawlFn(
      args.base, args.crawl.startPath,
      { maxDepth: args.crawl.maxDepth, maxPages: args.maxPages },
      args.fetcher, keep);
  }

  // Post-filter, then cap the first N survivors in DISCOVERY order (slice BEFORE
  // the alphabetical sort), then sort for stable output. maxPages 0 = unlimited.
  const kept = paths.filter(keep);
  const deduped = [...new Set(kept)]; // Set preserves first-seen order
  const capped = args.maxPages === 0 ? deduped : deduped.slice(0, args.maxPages);
  const sorted = capped.sort();
  if (sorted.length === 0) throw new Error("no pages discovered");
  return sorted;
}
```

- [ ] **Step 8: Run the discover tests to verify they pass**

Run: `bun test tests/discovery/discover.test.ts`
Expected: PASS.

- [ ] **Step 9: Make `--crawl` merge union-safe in `src/config/load.ts`**

The schema `crawl` is now `boolean | object`, so the existing spread `{ ...(merged.discovery?.crawl ?? {}) }` no longer typechecks (can't spread a boolean). Replace the `if (cli.crawl !== undefined) { ... }` block in `resolveConfig` with:

```typescript
  if (cli.crawl !== undefined) {
    const existing = merged.discovery?.crawl;
    const crawlObj = existing && typeof existing === "object" ? existing : {};
    merged.discovery = {
      ...(merged.discovery ?? {}),
      crawl: { ...crawlObj, enabled: cli.crawl },
    };
  }
```

- [ ] **Step 10: Update the discovery wiring in both commands**

In `src/commands/run.ts`, in the `discoverPaths({ ... })` call inside the `discover` closure, replace the `crawl: { ... maxPages: config.discovery.crawl.maxPages }` line with a top-level `maxPages` and a crawl object without `maxPages`:

```typescript
        base: config.prod,
        maxPages: config.discovery.maxPages,
        sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
```

Apply the identical change to the `discoverPaths({ ... })` call in `src/commands/snapshot.ts` (same field edits: add `maxPages: config.discovery.maxPages`, drop `maxPages` from the `crawl` object).

- [ ] **Step 11: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors. (The `load.test.ts` `crawl: true` override test still passes: `{ ...{}, enabled: true }` → the union normalizes to `{ enabled: true, startPath: "/", maxDepth: 3 }`.)

- [ ] **Step 12: Commit**

```bash
git add src/config/schema.ts src/discovery/discover.ts src/config/load.ts src/commands/run.ts src/commands/snapshot.ts tests/config/schema.test.ts tests/discovery/discover.test.ts
git commit -m "feat: global discovery.maxPages cap + opt-in crawl union"
```

---

## Task 3: CLI `--max-pages`

**Files:**
- Modify: `src/cli.ts`, `src/config/load.ts`
- Test: `tests/cli.test.ts`, `tests/config/load.test.ts`

**Interfaces:**
- Consumes: `CliOverrides`, `resolveConfig`, `discovery.maxPages` (Task 2).
- Produces: `CliOverrides` gains `maxPages?: number`; `parseCliArgs` sets `overrides.maxPages` from `--max-pages`; `resolveConfig` merges it into `discovery.maxPages`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli.test.ts`:

```typescript
test("parses --max-pages into overrides", () => {
  const p = parseCliArgs(["run", "--max-pages", "50"]);
  expect(p.overrides.maxPages).toBe(50);
});
```

Append to `tests/config/load.test.ts`:

```typescript
test("--max-pages overrides discovery.maxPages", () => {
  const c = resolveConfig(base, { maxPages: 42 });
  expect(c.discovery.maxPages).toBe(42);
});

test("maxPages 0 override is honored (not treated as absent)", () => {
  const c = resolveConfig(base, { maxPages: 0 });
  expect(c.discovery.maxPages).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/cli.test.ts tests/config/load.test.ts`
Expected: FAIL — `maxPages` is not parsed / not merged.

- [ ] **Step 3: Add `maxPages` to `CliOverrides` and merge it in `src/config/load.ts`**

In `src/config/load.ts`, add the field to `CliOverrides`:

```typescript
export interface CliOverrides {
  dev?: string;
  prod?: string;
  out?: string;
  concurrency?: number;
  crawl?: boolean;
  maxPages?: number;
}
```

Add this merge in `resolveConfig` (after the `concurrency` block, before the `crawl` block):

```typescript
  if (cli.maxPages !== undefined) {
    merged.discovery = { ...(merged.discovery ?? {}), maxPages: cli.maxPages };
  }
```

- [ ] **Step 4: Parse `--max-pages` in `src/cli.ts`**

In `parseCliArgs`, add to the `options` object:

```typescript
      "max-pages": { type: "string" },
```

And after the `concurrency` override mapping, add:

```typescript
  if (values["max-pages"]) overrides.maxPages = Number(values["max-pages"]);
```

Update the help-text `console.log` in `main()` to include `--max-pages N` in both the `snapshot` and `run` usage lines:

```typescript
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus snapshot [--prod URL] [--config FILE] [--concurrency N] [--max-pages N] [--crawl]\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--max-pages N] [--crawl]`);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/cli.test.ts tests/config/load.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/config/load.ts tests/cli.test.ts tests/config/load.test.ts
git commit -m "feat: add --max-pages CLI override for discovery.maxPages"
```

---

## Task 4: Docs + init scaffold

**Files:**
- Modify: `src/commands/init.ts`, `README.md`

**Interfaces:** none (docs/scaffold only).

- [ ] **Step 1: Update the `init` scaffold**

In `src/commands/init.ts`, replace the `discovery: { ... }` block inside the `configScaffold()` template string with:

```typescript
  discovery: {
    sitemap: true,
    maxPages: 500,
    crawl: false,
    include: ["/**"],
    exclude: ["/admin/**"],
  },
```

- [ ] **Step 2: Update the README config example**

In `README.md`, find the `discovery: { ... }` block in the `## Configuration` example and replace it with:

```markdown
  discovery: {
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
  which pages exist). If `sitemap` is enabled and returns pages, those are
  authoritative. **Crawling is opt-in** — set `crawl: true` (or a `crawl: { … }`
  object) to enable a same-origin link crawl; it runs only as a fallback when the
  sitemap yields no pages. `maxPages` caps the total pages compared — the first N
  that survive `include`/`exclude`, in discovery order — across sitemap or crawl
  (`0` disables the cap). Override per run with `--max-pages N`.
```

- [ ] **Step 4: Add `--max-pages` to the flag tables**

In `README.md`, add this row to **both** the `momus run [flags]` and `momus snapshot [flags]` flag tables (after the `--concurrency` row):

```markdown
| `--max-pages N` | Override the max pages to compare (`discovery.maxPages`; `0` = unlimited). |
```

- [ ] **Step 5: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS (docs/scaffold change touches no runtime behavior the suite asserts; the scaffold string is not snapshot-tested).

```bash
git add src/commands/init.ts README.md
git commit -m "docs: document discovery.maxPages cap and opt-in crawl"
```

---

## Self-Review

**1. Spec coverage:**
- §1 config (`discovery.maxPages` nonneg default 500 / 0=unlimited; `crawl` union default disabled; remove `crawl.maxPages`; legacy ignored) → Task 2 (schema + tests). ✓
- §2 cap semantics (post-filter, first-N discovery order, slice before sort, dedup preserves order) → Task 2 (`discoverPaths` + tests). ✓
- §3 crawler counts survivors, traverses through excluded, `maxPages:0` unlimited → Task 1. ✓
- §4 CLI `--max-pages` (parse, override, wins) → Task 3. ✓
- §5 command wiring (both `run` + `snapshot` pass top-level `maxPages`) → Task 2 Step 10. ✓
- §6 edge cases (0 unlimited, cap≥available, empty→throw, negative→validation error) → Task 1/2 tests. ✓
- §7 testing (discover cap ordering/after-filter/0; crawler keep/counts/0; schema union + maxPages; CLI) → Tasks 1–3. ✓
- §8 docs (README example, crawl opt-in note, init scaffold) → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code. ✓

**3. Type consistency:** `DiscoverArgs.maxPages` (top-level) + `crawl: { enabled, startPath, maxDepth }` (no `maxPages`) defined in Task 2 and matched by the command wirings (Task 2 Step 10) and the schema output shape (Task 2 Step 3). `crawlPaths(..., fetcher, keep?)` signature from Task 1 is consumed by `discoverPaths` and the `_crawlFn` seam type in Task 2. `CliOverrides.maxPages` (Task 3) merges into `discovery.maxPages` (Task 2). `CrawlOptions` stays `{ maxDepth, maxPages }` throughout. ✓

**Note for the implementer:** Task 2 is the largest task — it changes the config type, so schema, `discoverPaths`, both command wirings, and the `--crawl` merge must all land in the same commit to keep `tsc` green. Follow the steps in order; run `bunx tsc --noEmit` (Step 11) before committing.
