# ADR-0015: `stabilize.remove` deletes from the DOM; `mask` only hides

**Date:** 2026-07-05 · **Status:** Accepted

## Context

`stabilize.mask` hides dynamic regions before a screenshot using
`visibility: hidden`. The element becomes invisible but **keeps its layout box**,
so the page geometry is unchanged — exactly right for a carousel or an ad slot
sitting in a fixed frame.

It is wrong for cookie banners, floating chat widgets, and promo bars. Those
should be gone entirely so the page reflows the way it would without them.

## Decision

Add `stabilize.remove`, a sibling selector list that performs **true DOM
removal** (`element.remove()`), not a `display: none` CSS trick.

Ordering inside `capture()`:

```
addStyleTag(disableAnimations + maskCss)
  → removeSelectors(page, opts.remove)
  → wait settleMs
  → screenshot
```

## Consequences

- True removal is unconditional — no element's own `!important` can win a
  specificity fight against it — and it matches the user's stated intent.
- Animation-disabling CSS is injected *first* so any transition the reflow would
  trigger is already frozen, and removal happens *before* the settle wait so the
  reflow settles before the shot.
- An invalid selector is caught per-selector inside the page function and
  skipped, so a typo can never abort a capture
  ([ADR-0006](0006-errors-are-rows.md)). A selector matching nothing is a silent
  no-op.
- `remove` changes captured pixels, so it joins the baseline compatibility gate
  ([ADR-0010](0010-baseline-compatibility-gate.md)), compared as
  `config.stabilize.remove` against `snapshot.stabilize.remove ?? []` so
  pre-existing baselines don't spuriously conflict.
- It applies to both dev and prod captures — it is part of `stabilize`, which
  every `capture()` call uses — so both sides reflow identically and the diff
  stays meaningful.
