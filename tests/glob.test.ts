// tests/glob.test.ts
import { test, expect } from "bun:test";
import { matchPath } from "../src/glob";

test("exact match", () => {
  expect(matchPath("/pricing", "/pricing")).toBe(true);
  expect(matchPath("/pricing", "/about")).toBe(false);
});

test("single-segment wildcard * does not cross /", () => {
  expect(matchPath("/blog/post", "/blog/*")).toBe(true);
  expect(matchPath("/blog/post/comments", "/blog/*")).toBe(false);
});

test("globstar ** crosses segments", () => {
  expect(matchPath("/blog/post/comments", "/blog/**")).toBe(true);
  expect(matchPath("/blog", "/blog/**")).toBe(true);
  expect(matchPath("/admin", "/**")).toBe(true);
});

test("bare and mid-pattern globstar (regression guards)", () => {
  // bare ** (not preceded by /) still crosses segments
  expect(matchPath("/x/foo", "**/foo")).toBe(true);
  // mid-pattern /**/ backtracks for both zero and many intermediate segments
  expect(matchPath("/a/b", "/a/**/b")).toBe(true);
  expect(matchPath("/a/x/y/b", "/a/**/b")).toBe(true);
  expect(matchPath("/a/b/c", "/a/**/b")).toBe(false);
});
