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

test("has an inline (no-src) script and starts side by side", () => {
  const html = renderReport(rows, { dev: "d", prod: "p" });
  expect(html).toContain('<main data-mode="side">');
  expect(html).toMatch(/<script>[\s\S]*<\/script>/);  // inline script present
  expect(html).not.toMatch(/<script\s+src=/i);        // and it has no src
});

// --- RFC-0007 ---

test("filters list the statuses present, in triage order, with counts", () => {
  const html = renderReport(rows, { dev: "d", prod: "p" });
  const order = [...html.matchAll(/<button type="button" data-status="(\w+)" aria-pressed="true">/g)].map((m) => m[1]);
  expect(order).toEqual(["fail", "error", "pass"]);
  expect(html).toContain('data-status="fail" aria-pressed="true">Failed <span class="n">1</span></button>');
  expect(html).toContain('<input type="search" data-filter="path"');
  expect(html).toContain('<button type="button" data-action="group" aria-pressed="false">Group by target</button>');
  expect(html).toContain('<span class="shown"></span>');
});

test("source and viewport selects appear only when there is a choice", () => {
  const single = renderReport([rows[0]!], { dev: "d", prod: "p" });
  expect(single).not.toContain('<select data-filter="source"');
  expect(single).not.toContain('<select data-filter="viewport"');
  const html = renderReport([...rows, { ...rows[0]!, source: "scenarios", viewport: 375 }], { dev: "d", prod: "p" });
  expect(html).toContain('<select data-filter="source"><option value="">All sources</option><option value="pages">pages</option><option value="scenarios">scenarios</option></select>');
  expect(html).toContain('<select data-filter="viewport"><option value="">All viewports</option><option value="375">375</option><option value="1280">1280</option></select>');
});

test("every item carries its filter data, escaped", () => {
  const html = renderReport([{ ...rows[0]!, targetId: "t&1", label: 'a"<b' }, rows[2]!], { dev: "d", prod: "p" });
  expect(html).toContain('<details class="item fail" data-status="fail" data-source="pages" data-viewport="1280" data-target="t&amp;1" data-label="a&quot;&lt;b" data-rank="0.2">');
  expect(html).toContain('data-target="/broken" data-label="/broken" data-rank="Infinity">');
});

test("compared rows get the mode toolbar and range; error and added rows don't", () => {
  const html = renderReport([rows[0]!], { dev: "d", prod: "p" });
  for (const m of ["side", "slider", "onion", "highlight"]) expect(html).toContain(`<button type="button" data-mode="${m}"`);
  expect(html).toContain('<input type="range" class="mix" min="0" max="100" value="50"');
  expect(html).toContain('<button type="button" data-action="zoom" aria-pressed="false">1:1</button>');
  expect(html).toContain('<div class="triptych" style="--sw:1280px">');
  const others = renderReport([rows[2]!, ...changed], { dev: "d", prod: "p" });
  expect(others).not.toContain('class="viewer"');
});

test("images carry their size and, in thumbnails mode, the original", () => {
  const html = renderReport([{ ...rows[0]!, devWidth: 1280, devHeight: 2000 }], { dev: "d", prod: "p" },
    undefined, { images: () => ({ src: "t.png", full: "f.png" }) });
  expect(html).toContain('<img src="t.png" data-full="f.png" alt="dev" width="1280" height="2000" loading="lazy" decoding="async">');
  expect(html).toContain('<img src="t.png" data-full="f.png" alt="prod" loading="lazy" decoding="async">'); // size unknown
  expect(html).toContain('<figure data-side="diff">');
});

test("a narrower side gets its share of the stack width", () => {
  const html = renderReport([{ ...rows[0]!, devWidth: 640, devHeight: 2000, prodWidth: 1280, prodHeight: 2000 }], { dev: "d", prod: "p" });
  expect(html).toContain('<div class="frame" style="--fw:0.5000">');
  expect(html.match(/--fw:/g)!.length).toBe(1);
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

const changed: ComparisonRecord[] = [
  { targetId: "/new", source: "pages", label: "/new", path: "/new", viewport: 1280,
    devUrl: "d", prodUrl: "p", devImage: new Uint8Array([1]), status: "added" },
  { targetId: "scenarios:gone", source: "scenarios", label: "Gone scenario", path: "/", viewport: 1280,
    devUrl: "", prodUrl: "p", prodImage: new Uint8Array([2]), status: "removed" },
];

test("added and removed render their own badge and a single image", () => {
  const html = renderReport(changed, { dev: "d", prod: "p" });
  expect(html).toContain(">ADDED<");
  expect(html).toContain(">REMOVED<");
  expect(html).toContain("Gone scenario");          // label, not path
  expect(html).toContain('class="item added"');
  expect(html).toContain('class="item removed"');
  expect(html).toContain(" · 1 added · 1 removed</div>");
  expect(html).toContain("momus — FAIL");
});

test("allowed added/removed render a PASS verdict", () => {
  expect(renderReport(changed, { dev: "d", prod: "p" }, { allowAdded: true, allowRemoved: true }))
    .toContain("momus — PASS");
});

test("a source-level error row renders without a viewport", () => {
  const html = renderReport([{ targetId: "source:scenarios", source: "scenarios", label: "scenarios source",
    path: "", viewport: 0, devUrl: "", prodUrl: "", status: "error", error: "could not list scenarios targets: boom" }],
    { dev: "d", prod: "p" });
  expect(html).toContain("scenarios source");
  expect(html).not.toContain("@0");
});

test("a pages-only report's counts line is unchanged", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).toContain("3 comparisons · 1 passed · 1 failed · 1 errored</div>");
});

test("the header names the run when given", () => {
  const html = renderReport([], { dev: "d", prod: "p", runId: 12, startedAt: "2026-10-17T09:00:00Z" });
  expect(html).toContain("run #12 · 2026-10-17T09:00:00Z");
});

test("no run line without a run id", () => {
  expect(renderReport([], { dev: "d", prod: "p" })).not.toContain("run #");
});

test("a failed run with no comparisons renders FAIL and names the status, never PASS", () => {
  const html = renderReport([], { dev: "d", prod: "p", runId: 3, startedAt: "t0", status: "failed" });
  expect(html).toContain("momus — FAIL");
  expect(html).not.toContain("momus — PASS");
  expect(html).toContain("run #3 · t0 · failed");
});

test("a run still marked running renders FAIL even when every row passed", () => {
  const passing = rows.filter((r) => r.passed);
  const html = renderReport(passing, { dev: "d", prod: "p", runId: 4, startedAt: "t0", status: "running" });
  expect(html).toContain("momus — FAIL");
  expect(html).toContain("run #4 · t0 · incomplete");
});

test("a complete all-pass run still renders PASS without a status suffix", () => {
  const passing = rows.filter((r) => r.passed);
  const html = renderReport(passing, { dev: "d", prod: "p", runId: 5, startedAt: "t0", status: "complete" });
  expect(html).toContain("momus — PASS");
  expect(html).toContain("run #5 · t0</div>");
});

// --- RFC-0006 ---

const base: ComparisonRecord = {
  path: "/p", viewport: 1280, devUrl: "d", prodUrl: "p",
  devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
  width: 1280, height: 2000, diffPixels: 5, diffScore: 0.2, passed: false, status: "ok",
};
const one = (r: Partial<ComparisonRecord>) => renderReport([{ ...base, ...r }], { dev: "d", prod: "p" });

test("a size change is annotated, and the magenta band explained", () => {
  const html = one({ devWidth: 1280, devHeight: 2000, prodWidth: 1280, prodHeight: 1960 });
  expect(html).toContain("dev is 40 px taller than prod");
  expect(html).toContain("magenta");
  expect(one({ devWidth: 1280, devHeight: 2000, prodWidth: 1280, prodHeight: 2000 })).not.toContain("px taller");
});

test("the summary line counts regions, singular and plural", () => {
  expect(one({ regionCount: 3 })).toContain("3 regions");
  expect(one({ regionCount: 1 })).toContain("1 region<");
  expect(one({})).not.toMatch(/\d+ regions?</);
});

test("retries are shown when there were any", () => {
  expect(one({ retries: 2 })).toContain("2 retries");
  expect(one({ retries: 1 })).toContain("1 retry<");
  expect(one({ retries: 0 })).not.toMatch(/\d+ retr/);
});

test("regions are outlined at their position, as a percentage of each image", () => {
  const html = one({ regions: [{ x: 128, y: 200, width: 128, height: 400 }], regionCount: 1 });
  expect(html).toContain('class="box" style="left:10.000%;top:10.000%;width:10.000%;height:20.000%"');
});

test("dev and prod are outlined only when their own size is known", () => {
  const r = { regions: [{ x: 0, y: 0, width: 640, height: 1000 }], regionCount: 1 };
  expect(one(r).match(/class="box"/g)!.length).toBe(1); // the diff only
  const all = one({ ...r, devWidth: 1280, devHeight: 2000, prodWidth: 1280, prodHeight: 1000 });
  expect(all.match(/class="box"/g)!.length).toBe(3);
  expect(all).toContain('class="box" style="left:0.000%;top:0.000%;width:50.000%;height:100.000%"'); // prod
});

test("an error row shows whichever side rendered", () => {
  const html = renderReport([{ path: "/x", viewport: 375, devUrl: "d", prodUrl: "p", status: "error",
    error: "prod: HTTP 404", devImage: new Uint8Array([9]) }], { dev: "d", prod: "p" });
  expect(html).toContain("prod: HTTP 404");
  expect(html).toContain("<figcaption>dev</figcaption>");
  expect(html).not.toContain("<figcaption>prod</figcaption>");
});

test("an unstable row has its own badge, a mask hint, dashed boxes, and doesn't fail the run", () => {
  const html = one({ status: "unstable", unstableRegions: [{ x: 0, y: 0, width: 128, height: 200 }] });
  expect(html).toContain(">UNSTABLE<");
  expect(html).toContain("stabilize.mask");
  expect(html).toContain('class="box unstable"');
  expect(html).toContain('class="item unstable"');
  expect(html).toContain("momus — PASS");
  expect(html).toContain(" · 1 unstable</div>");
});

test("the counts line omits unstable when there is none", () => {
  expect(one({})).not.toContain("unstable</div>");
  expect(one({})).not.toContain(">UNSTABLE<");
});
