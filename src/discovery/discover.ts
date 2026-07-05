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
  // Authoritative include/exclude filter for the sitemap branch; idempotent for
  // the crawl branch (the crawler already applied `keep`).
  const kept = paths.filter(keep);
  const deduped = [...new Set(kept)]; // Set preserves first-seen order
  const capped = args.maxPages === 0 ? deduped : deduped.slice(0, args.maxPages);
  const sorted = capped.sort();
  if (sorted.length === 0) throw new Error("no pages discovered");
  return sorted;
}
