# ADR-0032: Determinism settings are gated, and a baseline that predates them reads as what it was captured with

**Date:** 2026-10-18 · **Status:** Accepted · **Implements:** [RFC-0006](../rfcs/0006-capture-determinism-and-diff-quality.md)

## Context

RFC-0006 adds four capture settings that change pixels: `waitForImages`,
`clock`, `reducedMotion` and `colorScheme`. Anything that changes pixels joins
the compatibility gate with a backward-compatible read default
([ADR-0010](0010-baseline-compatibility-gate.md)). The RFC also makes two of
them on by default: reduced motion, and waiting for images. Those two rules
pull apart. A baseline captured before this change had neither, so either the
new defaults refuse it, or the defaults keep the old behavior and the RFC's
defaults don't happen.

## Decision

**The new settings live under `stabilize`, are gated field by field, and a
baseline that lacks one reads as the behavior it was actually captured with:**
`waitForImages: false`, `clock` unset, `reducedMotion: "no-preference"`,
`colorScheme: "light"` (Playwright's default). Reading the absence as today's
default would be a lie: it would diff a reduced-motion capture against one
that wasn't.

**The defaults are the RFC's.** So a default config refuses a pre-RFC-0006
baseline. The conflict message names the setting, says the baseline predates
it, and says how to re-capture (`momus run --snapshot` or `momus snapshot`).
Users who can't re-capture yet set `reducedMotion: "no-preference"` and
`waitForImages: false`, which still diffs the old baseline exactly.

`clock` can't say "predates": JSON drops `undefined`, so a baseline from before
the setting and one captured without a clock store the same thing, and both
mean the real clock.

`stabilize.verify` sits under `stabilize` too but isn't gated: it changes no
pixels.

**Fonts were already awaited** before this RFC, unconditionally, so that wait
stays ungated.

**The image wait skips images that aren't rendered** (no client rects:
`display:none`, or inside it). They can't change pixels, and a lazy one there
is never requested, so waiting on it would spend the whole `timeoutMs` on
every capture. Images a scenario step reveals are not waited for: the wait
runs before the steps.

**The image wait runs inside the page with its own timer**, so the
`page.evaluate` always settles; racing a Node-side timeout would leave it
pending on an image that never loads. A related finding: the
post-scroll `waitForLoadState("networkidle")` returns at once, because
Playwright's load states are sticky once reached. So images that scrolling
requested were never waited for until `waitForImages`. Other scroll-triggered
resources still aren't.

## Consequences

- Upgrading momus means one re-capture for anyone on default settings, and
  Docker users must re-capture anyway ([ADR-0033](0033-rendering-environment-in-the-gate.md)).
  Pre-1.0 minors may break things; this one says so in the error itself.
- The v0.9.4 fixture test now states its pre-RFC capture explicitly, and a
  second test pins the refusal of a default config.
- `autoScroll` counts steps instead of reading `Date.now()`, which `clock`
  freezes. Timers keep running under Playwright's `setFixedTime`.
