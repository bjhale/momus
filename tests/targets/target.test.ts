// tests/targets/target.test.ts
import { test, expect } from "bun:test";
import { pageTarget, expandViewports, canonicalJson, checkTargetIds, type Target } from "../../src/targets/target";

const cfg = { dev: "https://dev.example.com", prod: "https://www.example.com" };

test("pageTarget: id and label are the path; URLs join each base", () => {
  expect(pageTarget("/pricing?x=1", cfg)).toEqual({
    id: "/pricing?x=1", source: "pages", label: "/pricing?x=1", path: "/pricing?x=1",
    url: { dev: "https://dev.example.com/pricing?x=1", prod: "https://www.example.com/pricing?x=1" },
  });
});

test("expandViewports: no narrowing returns the configured list", () => {
  expect(expandViewports(pageTarget("/", cfg), [375, 1280])).toEqual([375, 1280]);
});

test("expandViewports: narrows, keeps configured order, never adds widths", () => {
  const t: Target = { ...pageTarget("/", cfg), viewports: [1280, 999, 375] };
  expect(expandViewports(t, [375, 768, 1280])).toEqual([375, 1280]);
});

test("canonicalJson: undefined is null; key order does not matter", () => {
  expect(canonicalJson(undefined)).toBeNull();
  expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } }))
    .toBe(canonicalJson({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 }));
});

test("checkTargetIds: accepts page paths and prefixed ids", () => {
  const scenario: Target = { ...pageTarget("/", cfg), id: "scenarios:nav-open", source: "scenarios" };
  expect(() => checkTargetIds([pageTarget("/", cfg), scenario])).not.toThrow();
});

test("checkTargetIds: rejects a page id without a leading slash", () => {
  expect(() => checkTargetIds([{ ...pageTarget("/", cfg), id: "home" }]))
    .toThrow('target id "home" from source pages must start with "/"');
});

test("checkTargetIds: rejects a non-page id without its source prefix", () => {
  const bad: Target = { ...pageTarget("/", cfg), id: "nav-open", source: "scenarios" };
  expect(() => checkTargetIds([bad])).toThrow('target id "nav-open" from source scenarios must start with "scenarios:"');
});

test("checkTargetIds: rejects duplicates", () => {
  expect(() => checkTargetIds([pageTarget("/", cfg), pageTarget("/", cfg)]))
    .toThrow('duplicate target id "/"');
});
