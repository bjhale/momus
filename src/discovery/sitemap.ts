// src/discovery/sitemap.ts

/** Minimal fetch shape so tests can inject fixtures. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function extractLocs(xml: string): string[] {
  // matchAll avoids stateful RegExp; each match's group 1 is the <loc> content.
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
}

function toPath(base: string, url: string): string | null {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.host !== b.host) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/** Fetch {base}/sitemap.xml, recursing into sitemap-index files, return paths. */
export async function fetchSitemapPaths(base: string, fetcher: Fetcher): Promise<string[]> {
  const start = new URL("/sitemap.xml", base).toString();
  const seen = new Set<string>();
  const paths = new Set<string>();

  async function visit(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > 5 || seen.has(sitemapUrl)) return;
    seen.add(sitemapUrl);
    const res = await fetcher(sitemapUrl);
    if (!res.ok) return;
    const xml = await res.text();
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = extractLocs(xml);
    if (isIndex) {
      for (const child of locs) await visit(child, depth + 1);
    } else {
      for (const loc of locs) {
        const p = toPath(base, loc);
        if (p) paths.add(p);
      }
    }
  }

  await visit(start, 0);
  return [...paths];
}
