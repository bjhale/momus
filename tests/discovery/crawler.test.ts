// tests/discovery/crawler.test.ts
import { test, expect } from "bun:test";
import { crawlPaths } from "../../src/discovery/crawler";
import type { Fetcher } from "../../src/discovery/sitemap";

function html(links: string[]): string {
  return `<html><body>${links.map((h) => `<a href="${h}">x</a>`).join("")}</body></html>`;
}

function fakeFetch(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

test("BFS discovers same-domain links up to depth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "https://other.com/x"]),
    "https://www.example.com/a": html(["/c"]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 100 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b", "/c"]);
});

test("keeps links with fragments, stripping the fragment but keeping the query", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/docs?v=2#install"]),
    "https://www.example.com/docs?v=2": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 100 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/docs?v=2"]);
});

test("respects maxPages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 2 }, fetcher);
  expect(paths.length).toBe(2);
});

test("keep excludes pages from results but still traverses through them", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/skip"]),
    "https://www.example.com/skip": html(["/keep"]),
    "https://www.example.com/keep": html([]),
  });
  const keep = (p: string) => p !== "/skip";
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 0 }, fetcher, keep);
  expect(paths.sort()).toEqual(["/", "/keep"]);
});

test("maxPages counts only kept pages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c", "/d"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
    "https://www.example.com/d": html([]),
  });
  const keep = (p: string) => p !== "/a" && p !== "/b";
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 5, maxPages: 2 }, fetcher, keep);
  expect(paths).toEqual(["/", "/c"]);
});

test("maxPages 0 crawls unlimited, bounded only by maxDepth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a"]),
    "https://www.example.com/a": html(["/b"]),
    "https://www.example.com/b": html(["/c"]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/"], { maxDepth: 2, maxPages: 0 }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b"]);
});

test("seeds BFS from every start path", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html(["/c"]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", ["/a", "/b"], { maxDepth: 2, maxPages: 0 }, fetcher);
  expect(paths.sort()).toEqual(["/a", "/b", "/c"]);
});

test("deduplicates overlapping start paths", async () => {
  const fetcher = fakeFetch({ "https://www.example.com/a": html([]) });
  const paths = await crawlPaths("https://www.example.com", ["/a", "/a"], { maxDepth: 1, maxPages: 0 }, fetcher);
  expect(paths).toEqual(["/a"]);
});
