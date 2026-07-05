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
