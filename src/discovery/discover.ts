// src/discovery/discover.ts
import { matchPath } from "../glob";
import { fetchSitemapPaths, type Fetcher } from "./sitemap";
import { crawlPaths, type CrawlOptions } from "./crawler";

export interface DiscoverArgs {
  base: string;
  sitemap: boolean;
  crawl: { enabled: boolean } & CrawlOptions & { startPath: string };
  include: string[];
  exclude: string[];
  fetcher: Fetcher;
  // Injectable seams for tests; default to the real implementations.
  _sitemapFn?: (base: string, fetcher: Fetcher) => Promise<string[]>;
  _crawlFn?: (base: string, start: string, opts: CrawlOptions, fetcher: Fetcher) => Promise<string[]>;
}

/** Discovery source of truth is the given base (spec §3: prod). */
export async function discoverPaths(args: DiscoverArgs): Promise<string[]> {
  const sitemapFn = args._sitemapFn ?? fetchSitemapPaths;
  const crawlFn = args._crawlFn ?? crawlPaths;

  let paths: string[] = [];
  if (args.sitemap) {
    paths = await sitemapFn(args.base, args.fetcher);
  }
  // Conscious decision: the crawl fallback triggers only when the RAW sitemap
  // result is empty — measured BEFORE include/exclude filtering. A non-empty
  // sitemap is authoritative: if all its URLs are later filtered out, we do NOT
  // crawl; we instead throw "no pages discovered" below.
  if (paths.length === 0 && args.crawl.enabled) {
    paths = await crawlFn(args.base, args.crawl.startPath,
      { maxDepth: args.crawl.maxDepth, maxPages: args.crawl.maxPages }, args.fetcher);
  }

  const filtered = paths.filter((p) =>
    args.include.some((g) => matchPath(p, g)) &&
    !args.exclude.some((g) => matchPath(p, g)));

  const deduped = [...new Set(filtered)].sort();
  if (deduped.length === 0) throw new Error("no pages discovered");
  return deduped;
}
