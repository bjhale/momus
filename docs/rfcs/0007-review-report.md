# RFC-0007: Review report v2

**Status:** Draft · **Milestone:** M6 · **Created:** 2026-10-16

## Summary

Turn the report from a document you read into a tool you review with. It gets
comparison modes beyond side by side, keyboard-driven triage, and an approval
list the CLI can apply. It stays one self-contained file you can open anywhere.

## Motivation

Reviewing 200 comparisons in a list of accordions is slow, and the triptych
makes subtle shifts hard to spot. Reviewing is also where the approval workflow
([RFC-0003](0003-approval-workflow.md)) begins: the person looking at the diff
is the person deciding whether to approve it.

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

- Keyboard navigation: next or previous comparison, toggle mode,
  mark approve or reject.
- Filters: status (failed, errored, added, removed, unstable, passed), source,
  viewport, and path search.
- Group by target, showing every viewport of a target together.

### Approvals out of a static file

A static file can't write to the `.sqlite`. Marking comparisons builds an
**approval list**, which the reviewer copies or saves as a small JSON file, and
the CLI applies it:

```text
momus approve --from approvals.json
```

The list names the run id and each `(target, viewport)`, and the CLI refuses a
list from a different run. Downloads are sometimes blocked, for example in
sandboxed viewers, so copy to clipboard is the primary path.

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

## Compatibility

The report isn't a stable format; its HTML can change in any release. The
approval-list JSON *is* part of the contract and is versioned
([RFC-0009](0009-stability-contract.md)).

## Open questions

- ADR-0017 kept the report mostly free of JavaScript. Every mode above needs
  JavaScript. Is the fallback "triptych without JavaScript, everything else
  progressive enhancement," or is it time to supersede ADR-0017?
- Should the report embed one run, or optionally show a trend across the last N
  runs from history ([RFC-0002](0002-storage-and-run-history.md))?

## Done when

- [ ] Slider, onion skin, highlight and zoom work on Chromium, Firefox and
      WebKit-based browsers.
- [ ] Keyboard triage plus an approval list round-trips through
      `momus approve --from`.
- [ ] `--report-images` modes work; a 500-target report in `thumbnails` mode
      opens in under 2 s.
- [ ] An ADR supersedes or amends ADR-0017.
