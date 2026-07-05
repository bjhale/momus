# HTML Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the self-contained HTML report to show a top summary (verdict + counts + worst/viewports + URLs), render each comparison as a collapsed native `<details>` accordion, and add an All/Passed/Failed filter.

**Architecture:** A pure `summarize(records)` helper computes the summary + `itemClass` for filtering; `renderReport` consumes it and emits the new markup — a sticky summary header with a segmented filter, then worst-first collapsed `<details>` accordions. The filter is CSS keyed on each item's status class, toggled by a ~15-line inline `<script>`. The report stays a single self-contained file (inline CSS/JS, base64 images).

**Tech Stack:** Bun, TypeScript, `bun:test`. No new dependencies. Native `<details>`/`<summary>`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- Scope is `src/report/template.ts` (+ a new `src/report/summary.ts`); `src/report/report.ts` is **unchanged**.
- Report must remain **self-contained**: inline `<style>`, inline `<script>` (no `src`), base64 `data:` images. No remote `src`/`<script src>`/`<link href=https>`.
- Accordions are native `<details>` with **no `open` attribute** (all collapsed).
- Item status class: `error` → `error`; else `passed` → `pass`; else `fail`. Used by styling AND the filter.
- Filter: `data-filter` on `<main>` = `all` (default) | `passed` (show only `.item.pass`) | `failed` (hide `.item.pass`, i.e. show fail + error).
- Verdict = `PASS` iff `failed === 0 && errored === 0`, else `FAIL`.
- Items stay **worst-first** (errors as `Infinity`, then descending `diffScore`).
- `<title>momus report</title>` unchanged.
- Commit after each task.

---

## File Structure

- `src/report/summary.ts` — **create**: `summarize(records)` + `itemClass(r)` pure helpers.
- `src/report/template.ts` — **modify**: rewrite `renderReport` to the new markup, consuming the helpers; inline STYLES + SCRIPT constants.
- `README.md` — **modify**: one-line update to the report description.
- Tests: `tests/report/summary.test.ts` (new), `tests/report/template.test.ts` (rewrite), `tests/report/report.test.ts` (unchanged — title still present).

---

## Task 1: `summarize` + `itemClass` helpers

**Files:**
- Create: `src/report/summary.ts`
- Test: `tests/report/summary.test.ts`

**Interfaces:**
- Consumes: `ComparisonRecord` (from `../types`).
- Produces:
  - `interface ReportSummary { total: number; passed: number; failed: number; errored: number; verdict: "PASS" | "FAIL"; worst?: { path: string; viewport: number; pct: string }; viewports: number[] }`
  - `itemClass(r: ComparisonRecord): "pass" | "fail" | "error"`
  - `summarize(records: ComparisonRecord[]): ReportSummary`

- [ ] **Step 1: Write the failing tests**

Create `tests/report/summary.test.ts`:

```typescript
// tests/report/summary.test.ts
import { test, expect } from "bun:test";
import { summarize, itemClass } from "../../src/report/summary";
import type { ComparisonRecord } from "../../src/types";

function ok(path: string, vp: number, score: number, passed: boolean): ComparisonRecord {
  return { path, viewport: vp, devUrl: "d", prodUrl: "p", diffScore: score, passed, status: "ok" };
}
function err(path: string, vp: number): ComparisonRecord {
  return { path, viewport: vp, devUrl: "d", prodUrl: "p", status: "error", error: "boom" };
}

test("counts, verdict, worst, viewports", () => {
  const s = summarize([
    ok("/a", 1280, 0.02, false), // fail
    ok("/b", 375, 0.001, true),  // pass
    ok("/c", 768, 0.18, false),  // fail, worst
    err("/d", 1280),             // error
  ]);
  expect(s.total).toBe(4);
  expect(s.passed).toBe(1);
  expect(s.failed).toBe(2);
  expect(s.errored).toBe(1);
  expect(s.verdict).toBe("FAIL");
  expect(s.worst).toEqual({ path: "/c", viewport: 768, pct: "18.00" });
  expect(s.viewports).toEqual([375, 768, 1280]);
});

test("verdict is PASS only when all comparisons pass", () => {
  expect(summarize([ok("/a", 1280, 0, true), ok("/b", 1280, 0, true)]).verdict).toBe("PASS");
  expect(summarize([ok("/a", 1280, 0, true), err("/b", 1280)]).verdict).toBe("FAIL");
  expect(summarize([ok("/a", 1280, 0.1, false)]).verdict).toBe("FAIL");
});

test("worst is omitted when there are no ok comparisons", () => {
  const s = summarize([err("/a", 1280), err("/b", 375)]);
  expect(s.worst).toBeUndefined();
  expect(s.errored).toBe(2);
  expect(s.viewports).toEqual([375, 1280]);
});

test("itemClass maps status/passed", () => {
  expect(itemClass(ok("/a", 1280, 0, true))).toBe("pass");
  expect(itemClass(ok("/a", 1280, 0.1, false))).toBe("fail");
  expect(itemClass(err("/a", 1280))).toBe("error");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/report/summary.test.ts`
Expected: FAIL — `summarize`/`itemClass` not defined.

- [ ] **Step 3: Implement `src/report/summary.ts`**

```typescript
// src/report/summary.ts
import type { ComparisonRecord } from "../types";

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  verdict: "PASS" | "FAIL";
  /** Highest-diffScore ok comparison; omitted when there are no ok comparisons. */
  worst?: { path: string; viewport: number; pct: string };
  viewports: number[];
}

/** Per-item status class used by both styling and the filter. */
export function itemClass(r: ComparisonRecord): "pass" | "fail" | "error" {
  if (r.status === "error") return "error";
  return r.passed ? "pass" : "fail";
}

export function summarize(records: ComparisonRecord[]): ReportSummary {
  let passed = 0, failed = 0, errored = 0;
  let worst: ReportSummary["worst"];
  let worstScore = -1;

  for (const r of records) {
    if (r.status === "error") { errored++; continue; }
    if (r.passed) passed++; else failed++;
    const score = r.diffScore ?? 0;
    if (score > worstScore) {
      worstScore = score;
      worst = { path: r.path, viewport: r.viewport, pct: (score * 100).toFixed(2) };
    }
  }

  const viewports = [...new Set(records.map((r) => r.viewport))].sort((a, b) => a - b);
  return {
    total: records.length,
    passed, failed, errored,
    verdict: failed === 0 && errored === 0 ? "PASS" : "FAIL",
    worst, viewports,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/report/summary.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/report/summary.ts tests/report/summary.test.ts
git commit -m "feat: add report summarize + itemClass helpers"
```

---

## Task 2: Rewrite `renderReport` — summary, accordions, filter

**Files:**
- Modify: `src/report/template.ts`, `README.md`
- Test: `tests/report/template.test.ts` (rewrite)

**Interfaces:**
- Consumes: `summarize`, `itemClass`, `ReportSummary` (Task 1); `ComparisonRecord`.
- Produces: `renderReport(records: ComparisonRecord[], meta: { dev: string; prod: string }): string` (same signature) — new markup.

- [ ] **Step 1: Rewrite the template test**

Replace the contents of `tests/report/template.test.ts` with:

```typescript
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
  expect(renderReport(allPass, { dev: "d", prod: "p" })).toContain("PASS");
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/report/template.test.ts`
Expected: FAIL — the new summary/details/filter markup isn't emitted yet.

- [ ] **Step 3: Rewrite `src/report/template.ts`**

Replace the file contents with:

```typescript
// src/report/template.ts
import type { ComparisonRecord } from "../types";
import { summarize, itemClass } from "./summary";

function b64(bytes?: Uint8Array): string {
  if (!bytes) return "";
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** One comparison as a collapsed accordion. */
function item(r: ComparisonRecord): string {
  const cls = itemClass(r);
  if (r.status === "error") {
    return `<details class="item ${cls}">
  <summary><span class="badge err">ERROR</span> <span class="path">${esc(r.path)}</span> <span class="vp">@${r.viewport}</span></summary>
  <div class="msg">${esc(r.error ?? "unknown error")}</div>
</details>`;
  }
  const badge = r.passed ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
  const pct = ((r.diffScore ?? 0) * 100).toFixed(2);
  return `<details class="item ${cls}">
  <summary>${badge} <span class="path">${esc(r.path)}</span> <span class="vp">@${r.viewport}</span> <span class="score">${pct}%</span></summary>
  <div class="triptych">
    <figure><figcaption>dev</figcaption><img src="${b64(r.devImage)}" alt="dev"></figure>
    <figure><figcaption>prod</figcaption><img src="${b64(r.prodImage)}" alt="prod"></figure>
    <figure><figcaption>diff</figcaption><img src="${b64(r.diffImage)}" alt="diff"></figure>
  </div>
</details>`;
}

export function renderReport(
  records: ComparisonRecord[],
  meta: { dev: string; prod: string },
): string {
  // Worst-first: errors, then highest diffScore.
  const sorted = [...records].sort((a, b) => {
    const as = a.status === "error" ? Infinity : (a.diffScore ?? 0);
    const bs = b.status === "error" ? Infinity : (b.diffScore ?? 0);
    return bs - as;
  });
  const s = summarize(records);
  const items = sorted.map(item).join("\n");
  const worst = s.worst
    ? `worst: ${esc(s.worst.path)} @${s.worst.viewport} (${s.worst.pct}%)`
    : "worst: n/a";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>momus report</title>
<style>${STYLES}</style></head><body>
<header class="${s.verdict}">
  <div class="verdict">momus — ${s.verdict}</div>
  <div class="urls">${esc(meta.dev)} vs ${esc(meta.prod)}</div>
  <div class="counts">${s.total} comparisons · ${s.passed} passed · ${s.failed} failed · ${s.errored} errored</div>
  <div class="extras">${worst} · viewports: ${s.viewports.join(", ")}</div>
  <div class="filter">
    <button data-filter="all" class="active">All</button>
    <button data-filter="passed">Passed</button>
    <button data-filter="failed">Failed</button>
  </div>
</header>
<main data-filter="all">${items}</main>
<script>${SCRIPT}</script>
</body></html>`;
}

const STYLES = `
  body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 1rem 1.5rem; background: #000; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #333; }
  header .verdict { font-size: 1.25rem; font-weight: 700; }
  header.PASS .verdict { color: #3fb950; }
  header.FAIL .verdict { color: #f85149; }
  header .urls, header .counts, header .extras { color: #9aa0a6; margin-top: .25rem; }
  .filter { margin-top: .6rem; display: inline-flex; border: 1px solid #444; border-radius: .35rem; overflow: hidden; }
  .filter button { background: #1b1b1b; color: #ccc; border: 0; padding: .3rem .8rem; cursor: pointer; font: inherit; }
  .filter button + button { border-left: 1px solid #444; }
  .filter button.active { background: #2d6cdf; color: #fff; }
  .item { border-bottom: 1px solid #333; }
  .item > summary { cursor: pointer; padding: .7rem 1.5rem; display: flex; align-items: center; gap: .6rem; }
  .item .path { font-weight: 600; }
  .item .vp { color: #888; }
  .item .score { color: #aaa; margin-left: auto; }
  .badge { padding: .1rem .45rem; border-radius: .25rem; font-size: .72rem; font-weight: 700; }
  .badge.pass { background: #164; color: #cffcd8; }
  .badge.fail { background: #a22; color: #ffd9d9; }
  .badge.err { background: #9a6a12; color: #ffe9c2; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; padding: 0 1.5rem 1rem; }
  figure { margin: 0; }
  figcaption { color: #888; font-size: .75rem; margin-bottom: .25rem; }
  img { max-width: 100%; border: 1px solid #444; background: #fff; }
  .msg { color: #f99; padding: 0 1.5rem 1rem; }
  main[data-filter="passed"] .item:not(.pass) { display: none; }
  main[data-filter="failed"] .item.pass { display: none; }
`;

const SCRIPT = `
  var main = document.querySelector('main');
  var btns = document.querySelectorAll('.filter button');
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      main.dataset.filter = b.dataset.filter;
      btns.forEach(function (x) { x.classList.toggle('active', x === b); });
    });
  });
`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/report/template.test.ts tests/report/report.test.ts && bunx tsc --noEmit`
Expected: PASS. (`report.test.ts` is unchanged — the `<title>momus report</title>` it asserts is still emitted.)

- [ ] **Step 5: Update the README report description**

In `README.md`, in the "## How it works" section, replace the step 5 line:

```markdown
5. **Report** — write a self-contained `momus-report.html`, worst pages first,
   and exit with the code above.
```

with:

```markdown
5. **Report** — write a self-contained `momus-report.html`: a summary header
   (pass/fail verdict, counts, worst page, viewports) with an All/Passed/Failed
   filter, and each comparison as a collapsible accordion (page, width, change %,
   pass/fail) that expands to the `dev | prod | diff` screenshots — worst pages
   first. Then exit with the code above.
```

- [ ] **Step 6: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors.

- [ ] **Step 7: Manually verify the interactive report (optional but recommended)**

If a browser is handy, generate/open a report and confirm: accordions start
collapsed and expand on click; the All/Passed/Failed buttons show/hide rows and
highlight the active button; the summary verdict color matches PASS/FAIL. (The
unit tests cover the emitted structure; this confirms the inline script behaves.)

- [ ] **Step 8: Commit**

```bash
git add src/report/template.ts tests/report/template.test.ts README.md
git commit -m "feat: redesign report — summary, accordions, All/Passed/Failed filter"
```

---

## Self-Review

**1. Spec coverage:**
- §1 derived summary (counts, verdict, worst, viewports) → Task 1 (`summarize`). ✓
- §2 item status class → Task 1 (`itemClass`). ✓
- §3 markup (summary header, collapsed `<details>` accordions, triptych/error body) → Task 2 (`renderReport`/`item`). ✓
- §4 filter (data-filter CSS + inline script; Failed = fail∪error) → Task 2 (STYLES + SCRIPT + buttons). ✓
- §5 self-contained + styling (inline CSS/JS, base64, dark theme, title) → Task 2. ✓
- §6 testing (summary values, verdict logic, collapsed details + status classes, filter controls + inline no-src script, self-contained, title) → Task 1 tests + Task 2 tests + unchanged report.test. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code.

**3. Type consistency:** `summarize(records): ReportSummary` and `itemClass(r): "pass"|"fail"|"error"` (Task 1) are imported and used by `template.ts` (Task 2). `ReportSummary.worst` is `{ path, viewport, pct }` and rendered exactly so (`worst: {path} @{viewport} ({pct}%)`). Status classes (`pass`/`fail`/`error`) are consistent between `itemClass`, the `class="item …"` output, and the filter CSS selectors (`.item.pass`, `.item:not(.pass)`). Badge classes (`badge pass`/`badge fail`/`badge err`) are distinct from item classes and match the CSS. ✓

**Note for the implementer:** the interactive filter/accordion behaviour is DOM-level and not unit-tested (the string tests assert the machinery — buttons, `data-filter`, status classes, inline script — is present). Step 7 is the manual confirmation; do not add a real-browser test for it.
