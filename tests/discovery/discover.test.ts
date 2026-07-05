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
