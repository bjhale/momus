// tests/report/template.test.ts
import { test, expect } from "bun:test";
import { renderReport } from "../../src/report/template";
import type { ComparisonRecord } from "../../src/types";

const rows: ComparisonRecord[] = [
  { path: "/pricing", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1280, height: 2000, diffPixels: 500, diffScore: 0.2, passed: false, status: "ok" },
  { path: "/broken", viewport: 1280, devUrl: "d", prodUrl: "p", status: "error", error: "404 on dev" },
];

test("report contains pages, scores, and is self-contained", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).toContain("/pricing");
  expect(html).toContain("/broken");
  expect(html).toContain("404 on dev");
  expect(html).toContain("data:image/png;base64,");
  // Self-contained: no external network references of any kind (spec §3 stage 6).
  expect(html).not.toMatch(/src=["']https?:/);        // no remote <img>/<script> src
  expect(html).not.toMatch(/<script\s+src=/i);         // no external scripts at all
  expect(html).not.toMatch(/<link\b[^>]*href=["']https?:/i); // no remote stylesheets
  expect(html).toContain("FAIL");
});
