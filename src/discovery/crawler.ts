// src/discovery/crawler.ts
import type { Fetcher } from "./sitemap";

export interface CrawlOptions { maxDepth: number; maxPages: number }

function extractHrefs(html: string): string[] {
  // matchAll avoids stateful RegExp; group 1 is the href value.
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!);
}

/** Same-domain breadth-first crawl. Returns discovered paths (incl. start). */
export async function crawlPaths(
  base: string,
  startPath: string,
  opts: CrawlOptions,
  fetcher: Fetcher,
): Promise<string[]> {
  const baseHost = new URL(base).host;
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: startPath, depth: 0 }];

  while (queue.length > 0 && result.length < opts.maxPages) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const url = new URL(path, base).toString();
    const res = await fetcher(url);
    if (!res.ok) continue;
    result.push(path);
    if (result.length >= opts.maxPages) break;
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
