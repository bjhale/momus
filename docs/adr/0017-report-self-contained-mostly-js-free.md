# ADR-0017: Self-contained report, accordions without JS, one small script for the filter

**Date:** 2026-07-05 · **Status:** Accepted

## Context

The report started as every comparison rendered as an always-expanded card. On a
large run that is a long wall of images with no at-a-glance summary and no way to
focus on what failed. It needed a summary, collapsible items, and a
pass/fail filter.

The constraint that shapes all three: the report is **one self-contained HTML
file** — images inlined as base64 `data:` URIs, no external references — so it
can be emailed, committed, or opened from a CI artifact with no network.

## Decision

- **Accordions with zero JavaScript** — native `<details>`/`<summary>`, all
  collapsed by default (no `open` attribute anywhere).
- **Filter with ~15 lines of inline JavaScript.** Visibility is pure CSS keyed on
  a `data-filter` attribute on `<main>` and each item's status class; the script
  only swaps that attribute and the active button. A resettable three-way toggle
  cannot be done in CSS alone without hijacking form controls.
- **Three filter states** — All / Passed / Failed, where **Failed means "not
  passed"** and folds in errors, because an error *is* a gate failure
  ([ADR-0006](0006-errors-are-rows.md)).
- **Summary header** — verdict, dev/prod URLs, counts, worst comparison, and the
  viewport list.

## Consequences

- The script is inline, so the existing self-contained assertions still hold: no
  `src="http…"`, no `<script src>`, no remote `<link>`.
- Items stay sorted worst-first, with errors sorted as `Infinity`.
- Filtering only changes which rows are visible; each row's expanded state is
  independent and untouched.
- "Comparisons" is the count label, not "pages" — a page checked at three widths
  is three rows.
- `renderReport` stays a pure `(rows, meta) => string`, so it is tested by
  asserting structure: the buttons, the `data-filter` attributes, the status
  classes, the absence of `open=`, the inline script. Actual click behavior is
  verified manually.
