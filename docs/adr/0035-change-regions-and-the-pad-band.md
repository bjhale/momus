# ADR-0035: Change regions are grid-clustered boxes; the pad band is magenta and counts as a region

**Date:** 2026-10-18 · **Status:** Accepted · **Implements:** [RFC-0006](../rfcs/0006-capture-determinism-and-diff-quality.md)

## Context

"0.8 % of pixels changed" doesn't tell a reviewer where to look, and a page
that grew 40 px showed as a red band with no explanation. RFC-0006 asks for
clustered change regions, stored and drawn, and for size changes to be told
apart from content changes.

## Decision

**Regions are computed in the diff worker**, from pixelmatch's output: a pixel
drawn in the diff color (pure red, which pixelmatch's grayscale background
never produces), or outside either side's own bounds. Changed pixels are
bucketed into 16 px cells. Marked cells that touch, diagonals included, form
one region, and each box is tight to the real pixels in it. Changes about a
cell apart merge; changes further apart don't. The 100 largest regions are
stored (`regions_json`), plus the true count (`region_count`), so a page of
scattered noise can't bloat a row.

Grid clustering rather than pixel-level connected components: it's linear in
the image, needs no tuning beyond the cell size, and merges a changed word's
letters into one box, which is the unit a person reads.

**The pad band counts as a region and is drawn magenta** (`PAD_COLOR`) over
the diff image, so it reads apart from red content changes. On a pure size
change the band *is* the change, and leaving it out would report "0 regions"
on a failing page. The score still counts it: a size change is a regression
([ADR-0003](0003-pad-never-scale.md)).

**Each side's own size is stored** (`dev_width` … `prod_height`), and the report
says "dev is 40 px taller than prod". Padding is only ever right and bottom, so
one region list is valid on dev, prod and the diff alike; the report draws it
as boxes positioned in percentages of each image's own size, so the outlines
track the image however the page scales it, without JavaScript
([ADR-0017](0017-report-self-contained-mostly-js-free.md)).

## Consequences

- `DiffPool.submit` takes `{ threshold, includeAA }` instead of a bare
  threshold, and AA detection is now a setting (`diff.includeAA`, default
  false, which keeps today's behavior).
- Rows from before migration v5 have no per-side sizes; the report draws their
  regions on the diff only, and shows no size note.
