// src/targets/pages.ts
import type { ResolvedConfig } from "../config/schema";
import { pathFilter } from "../glob";
import { parseUrlList } from "../discovery/urllist";
import { pageTarget, type BaselineTargetRef, type TargetSource } from "./target";

export interface PagesSourceArgs {
  config: ResolvedConfig;
  /** Prod discovery (urlList ∪ sitemap, optional crawl). Only called for a snapshot. */
  discover: () => Promise<string[]>;
  /** Injectable for tests; defaults to reading the file from disk. */
  readUrlList?: (path: string) => Promise<string>;
}

/** Discovered pages as targets. On a run against a frozen baseline the baseline
 * determines the paths (ADR-0022): sitemap and crawl pages are never re-found,
 * so they are never `added`, and a page is never `removed`. A urlList is the
 * one way in for new pages. It is local, so re-reading it every run touches
 * neither the network nor prod. */
export function pagesSource(args: PagesSourceArgs): TargetSource {
  const { config } = args;
  const readUrlList = args.readUrlList ?? ((p: string) => Bun.file(p).text());

  return {
    name: "pages",

    async listForSnapshot() {
      return (await args.discover()).map((p) => pageTarget(p, config));
    },

    async listLive(baseline: BaselineTargetRef[]) {
      const known = [...new Set(baseline.map((b) => b.path))];
      const file = config.discovery.urlList;
      if (!file) return known.map((p) => pageTarget(p, config));

      const knownSet = new Set(known);
      const keep = pathFilter(config.discovery.include, config.discovery.exclude);
      const fresh = [...new Set(parseUrlList(await readUrlList(file), config.prod))]
        .filter((p) => keep(p) && !knownSet.has(p));
      // maxPages caps the total compared (ADR-0012). Without this, urlList
      // entries the cap dropped at snapshot time would show as `added` forever.
      const max = config.discovery.maxPages;
      const added = max === 0 ? fresh : fresh.slice(0, Math.max(0, max - known.length));
      return [...known, ...added].map((p) => pageTarget(p, config));
    },
  };
}
