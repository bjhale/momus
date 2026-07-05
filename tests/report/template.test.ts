// tests/report/template.test.ts
import { test, expect } from "bun:test";
import { renderReport } from "../../src/report/template";
import type { ComparisonRecord } from "../../src/types";

const rows: ComparisonRecord[] = [
  { path: "/pricing", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1280, height: 2000, diffPixels: 500, diffScore: 0.2, passed: false, status: "ok" },
  { path: "/about", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1280, height: 2000, diffPixels: 1, diffScore: 0.002, passed: true, status: "ok" },
  { path: "/broken", viewport: 375, devUrl: "d", prodUrl: "p", status: "error", error: "404 on dev" },
];

test("renders pages, error text, and base64 images", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).toContain("/pricing");
  expect(html).toContain("/about");
  expect(html).toContain("/broken");
  expect(html).toContain("404 on dev");
  expect(html).toContain("data:image/png;base64,");
});

test("is self-contained (no external references)", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).not.toMatch(/src=["']https?:/);              // no remote <img> src
  expect(html).not.toMatch(/<script\s+src=/i);              // no external scripts
  expect(html).not.toMatch(/<link\b[^>]*href=["']https?:/i);// no remote stylesheets
});

test("summary shows verdict, counts, worst, viewports, urls", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).toContain("FAIL");                     // verdict (a fail + an error present)
  expect(html).toContain("momus — FAIL");   // header verdict, not just a badge
  expect(html).toContain('class="FAIL"');   // header accent class
  expect(html).toContain("3 comparisons");
  expect(html).toContain("1 passed");
  expect(html).toContain("1 failed");
  expect(html).toContain("1 errored");
  expect(html).toContain("https://dev");
  expect(html).toContain("https://prod");
  expect(html).toContain("worst: /pricing @1280 (20.00%)");
  expect(html).toContain("viewports: 375, 1280");
});

test("verdict is PASS when every comparison passes", () => {
  const allPass: ComparisonRecord[] = [
    { path: "/", viewport: 1280, devUrl: "d", prodUrl: "p", diffScore: 0, passed: true, status: "ok" },
  ];
  const html = renderReport(allPass, { dev: "d", prod: "p" });
  expect(html).toContain("momus — PASS");     // header verdict
  expect(html).toContain('class="PASS"');     // header accent class
  expect(html).not.toContain("momus — FAIL"); // and definitely not FAIL
});

test("each comparison is a collapsed <details> with its status class", () => {
  const html = renderReport(rows, { dev: "d", prod: "p" });
  expect(html).toContain("<details");
  expect(html).toContain("<summary");
  expect(html).not.toMatch(/<details[^>]*\bopen\b/); // all collapsed
  expect(html).toContain('class="item fail"');
  expect(html).toContain('class="item pass"');
  expect(html).toContain('class="item error"');
});

test("has the All/Passed/Failed filter and an inline (no-src) script", () => {
  const html = renderReport(rows, { dev: "d", prod: "p" });
  expect(html).toContain('data-filter="all"');
  expect(html).toContain('data-filter="passed"');
  expect(html).toContain('data-filter="failed"');
  expect(html).toContain("<main data-filter=\"all\">");
  expect(html).toMatch(/<script>[\s\S]*<\/script>/);  // inline script present
  expect(html).not.toMatch(/<script\s+src=/i);        // and it has no src
});

test("all-error report: FAIL verdict and worst: n/a", () => {
  const allError: ComparisonRecord[] = [
    { path: "/a", viewport: 1280, devUrl: "d", prodUrl: "p", status: "error", error: "boom" },
    { path: "/b", viewport: 375, devUrl: "d", prodUrl: "p", status: "error", error: "boom" },
  ];
  const html = renderReport(allError, { dev: "d", prod: "p" });
  expect(html).toContain("momus — FAIL");
  expect(html).toContain("0 passed");
  expect(html).toContain("2 errored");
  expect(html).toContain("worst: n/a");
});
