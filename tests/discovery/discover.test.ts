// tests/discovery/discover.test.ts
import { test, expect } from "bun:test";
import { discoverPaths } from "../../src/discovery/discover";
import type { Fetcher } from "../../src/discovery/sitemap";

const fetcher: Fetcher = async () => ({ ok: false, status: 404, text: async () => "" });

test("filters via include/exclude and dedupes/sorts", async () => {
  // Sitemap is non-empty, so crawl is NOT used (it is a fallback). This test
  // exercises dedupe (two "/"), exclude ("/admin/**"), and sorting.
  const paths = await discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: ["/admin/**"],
    fetcher,
    _sitemapFn: async () => ["/pricing", "/", "/admin/secret", "/"],
    _crawlFn: async () => { throw new Error("crawl must not run when sitemap is non-empty"); },
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("falls back to crawl when sitemap yields nothing", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: [],
    fetcher,
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
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: false, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: ["/about"],
    fetcher: wiredFetcher,
    // No _sitemapFn / _crawlFn: exercises the default `?? fetchSitemapPaths` wiring.
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("throws when no pages discovered", async () => {
  await expect(discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: false, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: [],
    fetcher,
    _sitemapFn: async () => [],
    _crawlFn: async () => [],
  })).rejects.toThrow(/no pages discovered/i);
});
