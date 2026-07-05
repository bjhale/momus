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
