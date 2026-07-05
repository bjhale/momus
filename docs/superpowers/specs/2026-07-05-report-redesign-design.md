# Design: HTML report redesign — summary + accordions + filter

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Problem

The current report renders every comparison as an always-expanded card
(`path @viewport`, PASS/FAIL, `% changed`, and the `dev|prod|diff` triptych),
worst-first, dark theme, fully self-contained. On a large run it's a long wall of
images with no at-a-glance summary and no way to focus. We want:

1. A **summary** at the top of the page.
2. Each comparison as a **collapsible accordion** — header shows page, width,
   change %, pass/fail; expanding reveals the screenshots.
3. A **filter** to show All / Passed / Failed items.

## Decisions (from brainstorming)

- **Summary:** overall verdict + counts + extras (worst, viewports) + dev/prod URLs.
- **Accordion default:** all collapsed.
- **Filter:** three states — All / Passed / Failed, where **Failed = not passed
  (fail OR error)**.
- **JS-free where possible:** native `<details>`/`<summary>` for accordions (no
  JS). The filter needs a ~15-line inline `<script>` (a reset-able three-way
  toggle can't be pure CSS). Inline only — the report stays a single
  self-contained file (no external `src`).
- Count label is **"comparisons"** (a page checked at 3 widths = 3 rows).

Scope is `src/report/template.ts` only (`renderReport` stays a pure
`(rows, meta) => string`); `src/report/report.ts` is unchanged.

## 1. Derived summary data

From the records (computed in `renderReport` or a small helper):

- `total` = `records.length`
- `passed` = count of `status === "ok" && passed === true`
- `failed` = count of `status === "ok" && passed === false`
- `errored` = count of `status === "error"`
- `verdict` = `passed === total` (i.e. `failed === 0 && errored === 0`) ? `"PASS"` : `"FAIL"`
- `worst` = the `ok` record with the highest `diffScore` → `{ path, viewport, pct }`; omitted when there are no `ok` records
- `viewports` = distinct `viewport` values, ascending

## 2. Per-item status class

Each comparison maps to one class used by both styling and the filter:

- `status === "error"` → `error`
- else `passed` → `pass`
- else → `fail`

## 3. Markup structure

```html
<header class="{PASS|FAIL}">
  <div class="verdict">momus — FAIL</div>
  <div class="urls">{dev} vs {prod}</div>
  <div class="counts">40 comparisons · 32 passed · 6 failed · 2 errored</div>
  <div class="extras">worst: /pricing @1280 (18.40%) · viewports: 375, 768, 1280</div>
  <div class="filter">
    <button data-filter="all" class="active">All</button>
    <button data-filter="passed">Passed</button>
    <button data-filter="failed">Failed</button>
  </div>
</header>

<main data-filter="all">
  <details class="item fail">
    <summary>
      <span class="badge fail">FAIL</span>
      <span class="path">/pricing</span>
      <span class="vp">@1280</span>
      <span class="score">18.40%</span>
    </summary>
    <div class="triptych">
      <figure><figcaption>dev</figcaption><img src="data:image/png;base64,…" alt="dev"></figure>
      <figure><figcaption>prod</figcaption><img … alt="prod"></figure>
      <figure><figcaption>diff</figcaption><img … alt="diff"></figure>
    </div>
  </details>

  <details class="item error">
    <summary><span class="badge err">ERROR</span> <span class="path">/blog</span> <span class="vp">@375</span></summary>
    <div class="msg">{error message}</div>
  </details>
  …
</main>
<script>…filter wiring…</script>
```

- **No `open` attribute** on any `<details>` → all collapsed by default.
- Items remain **worst-first** sorted (errors as `Infinity`, then descending
  `diffScore`) — unchanged from today.
- `esc()` / `b64()` helpers reused unchanged.

## 4. Filter behaviour (CSS + tiny inline JS)

The filter is driven by a `data-filter` attribute on `<main>`, toggled by the
header buttons. Visibility is pure CSS keyed on the item's status class:

```css
main[data-filter="passed"] .item:not(.pass) { display: none; }
main[data-filter="failed"] .item.pass       { display: none; }
/* data-filter="all" (default) hides nothing */
.filter button.active { /* highlighted */ }
```

Inline script (the only JS in the report):

```html
<script>
  const main = document.querySelector('main');
  const btns = document.querySelectorAll('.filter button');
  btns.forEach((b) => b.addEventListener('click', () => {
    main.dataset.filter = b.dataset.filter;
    btns.forEach((x) => x.classList.toggle('active', x === b));
  }));
</script>
```

Filtering only changes which rows are visible; each row's collapsed/expanded
state is independent and untouched. `Failed` shows `.fail` and `.error` (errors
are gate failures).

## 5. Self-contained + styling

- Inline `<style>` + inline `<script>` + base64 `data:` images. **No external
  references** — the existing self-contained assertions (no remote
  `src`/`<script src>`/`<link href=https>`) still hold because the script is
  inline.
- Dark, dense, functional theme, lightly polished: verdict accent (green PASS /
  red FAIL), badge colors (pass green / fail red / error amber), the segmented
  filter control, sticky header. Triptych stays a 3-column grid.
- `<title>momus report</title>` unchanged.

## 6. Testing

`renderReport` remains a pure string function, asserted structurally:

- **Summary**: output contains the verdict word (`FAIL` when any fail/error,
  `PASS` when all pass), the passed/failed/errored counts, the dev/prod URLs, the
  worst line, and the viewport list.
- **Verdict logic**: an all-passing record set renders `PASS`; a set with a
  failure or an error renders `FAIL`.
- **Accordions**: emits `<details>` + `<summary>`; **no `open=` attribute**
  anywhere (all collapsed); each item's `<details>` carries its status class
  (`item pass` / `item fail` / `item error`); ok items include the three
  `data:image/png;base64,` images; error items include the error message.
- **Filter**: the three filter buttons (`data-filter="all|passed|failed"`) are
  present; `<main data-filter="all">` is present; an inline `<script>` is present
  and has **no `src`** attribute.
- **Self-contained** (kept from today): no `src=["']https?:`, no `<script src=`,
  no remote `<link href=https>`.
- `report.test.ts`: `<title>momus report</title>` still present.
- **Interactive filter click behaviour is verified manually** (open the report in
  a browser) — DOM behaviour is out of scope for the string-level unit tests; the
  structural tests confirm the buttons, `data-filter`, status classes, and script
  are all wired.

## Out of scope

- Expand-all / collapse-all controls (each accordion clicks individually).
- A fourth "Errored" filter (errors fold into "Failed").
- Search / free-text filtering, per-viewport grouping, sorting controls.
- Any change to `report.ts`, capture, diff, or the DB.
