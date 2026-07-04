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
  const paths = await crawlPaths("https://www.example.com", "/", {
    maxDepth: 2, maxPages: 100,
  }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b", "/c"]);
});

test("keeps links with fragments, stripping the fragment but keeping the query", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/docs?v=2#install"]),
    "https://www.example.com/docs?v=2": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", "/", {
    maxDepth: 2, maxPages: 100,
  }, fetcher);
  expect(paths.sort()).toEqual(["/", "/docs?v=2"]);
});

test("respects maxPages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", "/", {
    maxDepth: 5, maxPages: 2,
  }, fetcher);
  expect(paths.length).toBe(2);
});
