# RFC-0007: Review report v2

**Status:** Draft · **Milestone:** M6 · **Created:** 2026-10-16

## Summary

Turn the report from a document you read into a tool you review with. It gets
comparison modes beyond side by side and keyboard-driven triage. It stays one
self-contained file you can open anywhere.

## Motivation

Reviewing 200 comparisons in a list of accordions is slow, and the triptych
makes subtle shifts hard to spot.

## Today

- A static HTML file with images embedded, accordions that work without
  JavaScript, and a small inline filter script
  ([ADR-0017](../adr/0017-report-self-contained-mostly-js-free.md)).
- Only the dev | prod | diff triptych view.

## Proposal

### Comparison modes

- **Side by side:** today's view, kept as the no-JavaScript fallback.
- **Slider:** drag a divider across dev and prod overlaid.
- **Onion skin:** fade the opacity between dev and prod.
- **Highlight:** dev with the change regions outlined
  ([RFC-0006](0006-capture-determinism-and-diff-quality.md)).
- Zoom to 1:1 and pan, which matters for full-page captures that are thousands
  of pixels tall.

### Triage

- Keyboard navigation: next or previous comparison, toggle mode.
- Filters: status (failed, errored, added, removed, unstable, passed), source,
  viewport, and path search.
- Group by target, showing every viewport of a target together.

### Size

Full-page PNGs embedded in base64 make reports for large sites very heavy. Add
`--report-images embed | link | thumbnails`:

- `link` writes images next to the report.
- `thumbnails` embeds downscaled previews, with the originals linked.

Downscaling is for *display* only; diffs are never computed on scaled images
([ADR-0003](../adr/0003-pad-never-scale.md)).

## Non-goals

- A served or live report. Serving is the 2.0 server's review UI
  ([RFC-0010](0010-server.md)).
- Comments or discussion threads.
- Approving or rejecting changes. Approval moves to the 2.0 server
  ([ADR-0028](../adr/0028-approval-belongs-to-the-server.md)); the report's triage is its read-only precursor.

## Compatibility

The report isn't a stable format; its HTML can change in any release.

## Open questions

- ADR-0017 kept the report mostly free of JavaScript. Every mode above needs
  JavaScript. Is the fallback "triptych without JavaScript, everything else
  progressive enhancement," or is it time to supersede ADR-0017?
- Should the report embed one run, or optionally show a trend across the last N
  runs from history ([RFC-0002](0002-storage-and-run-history.md))?

## Done when

- [ ] Slider, onion skin, highlight and zoom work on Chromium, Firefox and
      WebKit-based browsers.
- [ ] Keyboard triage and filters work without a mouse.
- [ ] `--report-images` modes work; a 500-target report in `thumbnails` mode
      opens in under 2 s.
- [ ] An ADR supersedes or amends ADR-0017.
