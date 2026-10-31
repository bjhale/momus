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
  /** Origin full-URL urlList entries are parsed against. Defaults to `config.prod`;
   * a run passes the baseline's prod origin so a changed `prod` can't make every
   * full-URL entry throw and fail the whole source. */
  urlListBase?: string;
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
      const listed = [...new Set(parseUrlList(await readUrlList(file), args.urlListBase ?? config.prod))]
        .filter(keep);
      // maxPages caps the urlList itself (ADR-0012: urlList seeds come first in
      // discovery order). Entries the cap dropped at snapshot are exactly those
      // beyond maxPages in file order, so they stay excluded and are not `added`
      // forever; nothing listed within the cap is hidden, so a new entry is
      // always reported even when the baseline is already full.
      const max = config.discovery.maxPages;
      const capped = max === 0 ? listed : listed.slice(0, max);
      const added = capped.filter((p) => !knownSet.has(p));
      return [...known, ...added].map((p) => pageTarget(p, config));
    },
  };
}
