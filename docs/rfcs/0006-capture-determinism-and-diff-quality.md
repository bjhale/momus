# RFC-0006: Capture determinism and diff quality

**Status:** Draft · **Milestone:** M5 · **Created:** 2026-10-16

## Summary

Reduce false positives at the source, by making captures more repeatable and
detecting the ones that aren't. Then make the diff explain itself, so that
what a reviewer sees is what actually changed. A visual regression tool's whole
value is whether people trust a red result. Every flaky red result trains them
not to.

## Motivation

- **Pages aren't deterministic.** Late-loading fonts, lazy images, carousels,
  relative timestamps, and A/B tests all change pixels between two captures of
  identical code.
- **The engine isn't fully deterministic either.** GPU compositing,
  subpixel text and font hinting vary by host. The Docker image narrows this,
  but doesn't close it.
- **Some diffs need explaining.** A page that grew 40 px shows as a large red
  band with no explanation. A one-sided failure (dev renders, prod 404s) hides
  the side that worked. Both are known gaps, listed in the
  [README](../../README.md#notes--known-limitations).

## Today

- Stabilization means `waitUntil`, `settleMs`, disabled animations, `mask`, and
  `remove` ([stabilize.ts](../../src/capture/stabilize.ts)), plus scrolling to
  trigger lazy loading.
- Diffing is pixelmatch with one per-pixel `threshold` and a page-level
  `failScore` ([ADR-0004](../adr/0004-two-threshold-knobs.md)). Mismatched
  dimensions are padded, never scaled
  ([ADR-0003](../adr/0003-pad-never-scale.md)).

## Proposal

### Repeatable captures

- **Wait for fonts:** await `document.fonts.ready` before capture, always.
- **Wait for images:** wait until every `<img>` in the document has decoded,
  bounded by `timeoutMs`.
- **Freeze time:** `stabilize.clock: "<ISO date>"` uses Playwright's clock API
  to pin `Date` and timers, so "posted 3 minutes ago" renders the same. Off by
  default, because it can break apps that poll.
- **Reduced motion and color scheme:** emulate `prefers-reduced-motion: reduce`
  by default; make `colorScheme` configurable.
- **Pinned rendering:** fix the device scale factor, the font-smoothing flags,
  and disable GPU compositing in the Docker image. Document this as the
  reference rendering environment.

### Detecting instability

- `stabilize.verify: true` captures each prod or baseline target twice. If the
  two captures differ, the target is marked **unstable**, a new status. It
  isn't reported as a regression, and the report shows which region changed so
  it can be masked.
- `retries: N` re-captures a target that failed the gate, up to N times, and
  only fails it if every attempt fails. The retry count is recorded on the
  comparison, so flakiness stays visible instead of being swallowed.

### Diffs that explain themselves

- Store each side's original dimensions. When they differ, the report says so
  ("dev is 40 px taller") and the padded band is drawn distinctly from content
  diffs.
- A one-sided failure stores and shows the side that rendered.
- Anti-aliasing detection is on by default (pixelmatch's `includeAA: false`),
  with the setting exposed.
- **Change regions:** cluster changed pixels into bounding boxes and store them.
  The report draws them as outlines, and "3 regions changed" is a better summary
  than "0.8 % of pixels."

## Non-goals

- Perceptual or ML-based diffing. Pixel diffs plus good stabilization stay
  explainable. A perceptual metric is a possible 1.x addition behind a flag.
- Rendering-equivalent output across hosts. The Docker image is the supported
  reference; a capture made outside it is best effort.

## Compatibility

Every capture-side change alters pixels, so each one must join the compatibility
gate with a backward-compatible default
([ADR-0010](../adr/0010-baseline-compatibility-gate.md)). The image-render
waits are the exception: they can be unconditional only if they make no
difference to an already-stable page, and that has to be shown, not assumed. The
safer path is to gate them like everything else.

## Open questions

- Should `verify` double the cost of every snapshot by default, or be opt-in?
- Should the Docker image's rendering flags be part of the baseline identity, so
  that a baseline from a bare-metal Chromium is refused?

## Done when

- [ ] Fonts and images are awaited; `clock`, `colorScheme` and reduced motion
      are configurable and gated.
- [ ] The `unstable` status and `retries` work, and are visible in the report.
- [ ] Dimension changes and one-sided failures are annotated; both README known
      limitations are removed.
- [ ] Change regions are stored and drawn.
- [ ] A flake benchmark: a fixture site with known nondeterminism runs N times,
      with zero false failures after stabilization.
