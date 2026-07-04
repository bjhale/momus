// tests/discovery/sitemap.test.ts
import { test, expect } from "bun:test";
import { fetchSitemapPaths } from "../../src/discovery/sitemap";

function fakeFetch(map: Record<string, string>) {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

test("parses a flat sitemap into paths", async () => {
  const xml = await Bun.file("tests/fixtures/sitemap-flat.xml").text();
  const fetcher = fakeFetch({ "https://www.example.com/sitemap.xml": xml });
  const paths = await fetchSitemapPaths("https://www.example.com", fetcher);
  expect(paths.sort()).toEqual(["/", "/about", "/pricing"]);
});

test("recurses into a sitemap index", async () => {
  const index = await Bun.file("tests/fixtures/sitemap-index.xml").text();
  const child = await Bun.file("tests/fixtures/sitemap-child.xml").text();
  const fetcher = fakeFetch({
    "https://www.example.com/sitemap.xml": index,
    "https://www.example.com/sitemap-child.xml": child,
  });
  const paths = await fetchSitemapPaths("https://www.example.com", fetcher);
  expect(paths).toEqual(["/blog/post-1"]);
});

test("returns empty array when sitemap missing", async () => {
  const paths = await fetchSitemapPaths("https://www.example.com", fakeFetch({}));
  expect(paths).toEqual([]);
});
