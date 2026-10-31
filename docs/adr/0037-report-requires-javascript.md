# ADR-0037: The report requires JavaScript; images can be linked or previewed

**Date:** 2026-10-19 · **Status:** Accepted · **Supersedes:** [ADR-0017](0017-report-self-contained-mostly-js-free.md)

## Context

ADR-0017 kept the report almost free of JavaScript: native `<details>`
accordions and a 15-line filter. [RFC-0007](../rfcs/0007-review-report.md) turns
the report into a review tool: slider, onion skin, highlight, 1:1 zoom with pan,
keyboard triage, richer filters, group-by-target. Every one of those needs a
script. A no-JavaScript fallback would mean building and testing each view
twice, for a reader who opens a local file in a browser that, in practice,
always runs scripts.

ADR-0017 also embedded every image as base64, so a large site's report grew to
hundreds of megabytes.

## Decision

**The report requires JavaScript.** It is still one inline script (`src/report/client.ts`) and one inline
stylesheet: no `<script src>`, no remote `<link>`, nothing fetched from
the network.

**Images appear once; modes are layouts.** The dev, prod and diff figures are
rendered once per comparison. Side by side, slider, onion skin and highlight are
CSS layouts of those same figures keyed on `<main data-mode>`; the script flips
attributes and CSS variables, and never copies an image. The mode is **global**
(stepping through comparisons keeps the view a reviewer chose); zoom is per
comparison.

**Filters replace All/Passed/Failed.** One toggle per status present (failed,
errored, added, removed, unstable, passed), a source select, a viewport select,
and a case-insensitive name search. ADR-0017's "Failed means not passed" folding
is gone: each status is its own toggle.

**`output.reportImages` / `--report-images`:**

- `embed` (default) keeps ADR-0017's guarantee: one self-contained file.
- `link` writes the PNGs to `<report name>-images/` beside the report and
  references them by relative path. Re-rendering removes the images this mode
  wrote earlier, and nothing else.
- `thumbnails` embeds 400 px-wide WebP previews (quality 60) and links the
  originals, which the 1:1 view loads on demand.

**Thumbnails are WebP, made by `Bun.Image`.** PNG was tried first: a downscaled
page is mostly antialiased text, which PNG barely compresses (a real 1280×5928
capture went from 788 KB to a 359 KB preview). WebP made it 63 KB. `Bun.Image`
ships with Bun 1.4.3, which [ADR-0036](0036-bun-1-4-3-one-test-process.md)
already requires, so there is no new dependency. Downscaling is for display
only: diffs are computed on the full-size captures
([ADR-0003](0003-pad-never-scale.md)) and thumbnails are never stored.

## Consequences

- Only `embed` reports are single files. A `link` or `thumbnails` report must be
  moved or shared together with its `-images` directory.
- `renderReport` stays pure: images come in through an injected `ImageSource`,
  and `report.ts` does all file I/O.
- Interactive behavior is no longer "verified manually": it is covered by
  browser tests that loop over every engine (`tests/report/client.integration.test.ts`), as are the
  timings (`tests/report/perf.integration.test.ts`: a 500-target `thumbnails`
  report must open in under 2 s).
- The script is ES5 so it runs as-is from a `file://` URL, with no build step.
- `Bun.Image` is a new API. If it changes, thumbnails break, and nothing else in
  the report does.
