// tests/discovery/urllist.test.ts
import { test, expect } from "bun:test";
import { parseUrlList } from "../../src/discovery/urllist";

const PROD = "https://www.example.com";

test("full URL under prod base becomes a path", () => {
  expect(parseUrlList("https://www.example.com/pricing", PROD)).toEqual(["/pricing"]);
});

test("bare prod base URL becomes root", () => {
  expect(parseUrlList("https://www.example.com", PROD)).toEqual(["/"]);
});

test("path lines are used as-is; missing leading slash is added", () => {
  expect(parseUrlList("/pricing\nabout", PROD)).toEqual(["/pricing", "/about"]);
});

test("blank and whitespace-only lines are skipped", () => {
  expect(parseUrlList("/a\n\n   \n/b", PROD)).toEqual(["/a", "/b"]);
});

test("fragments stripped, query kept", () => {
  expect(parseUrlList("https://www.example.com/docs?v=2#install\n/x#top", PROD))
    .toEqual(["/docs?v=2", "/x"]);
});

test("mixed full URLs and paths in one file", () => {
  expect(parseUrlList("https://www.example.com/a\n/b", PROD)).toEqual(["/a", "/b"]);
});

test("off-base full URL throws naming the offending line", () => {
  expect(() => parseUrlList("https://staging.acme.com/x", PROD))
    .toThrow(/not under prod base .*staging\.acme\.com\/x/);
});

test("false-prefix host is rejected as off-base", () => {
  expect(() => parseUrlList("https://www.example.com.evil.com/x", PROD))
    .toThrow(/not under prod base/);
});

test("trailing slash on prod base is normalized", () => {
  expect(parseUrlList("https://www.example.com/pricing", "https://www.example.com/"))
    .toEqual(["/pricing"]);
});

test("uppercase scheme under prod base is accepted", () => {
  expect(parseUrlList("HTTPS://www.example.com/pricing", PROD)).toEqual(["/pricing"]);
});
