# ADR-0019: Selectable browser engine, gated against the baseline

**Date:** 2026-07-10 · **Status:** Accepted

## Context

The capture engine was hardcoded to Chromium. Rendering differs meaningfully
between engines, and users testing Safari- or Firefox-specific layout need momus
to drive those engines. Playwright already ships all three.

## Decision

A top-level `browser` config field — `chromium` (default) | `firefox` |
`webkit` — with a `--browser` CLI override, resolved through an engine map in
`src/capture/browser.ts`.

The engine is persisted in the `snapshot` row and **participates in the baseline
compatibility gate** ([ADR-0010](0010-baseline-compatibility-gate.md)), so a
Firefox dev build cannot be silently diffed against a Chromium baseline.

`momus install-browser` installs all three, and the Docker image bakes in all
three.

## Consequences

- Config must be resolved **before** the browser presence check, since config
  determines which engine to look for. Both commands were reordered, and the
  "no browser found" message names the engine
  ([ADR-0007](0007-never-auto-download-browser.md)).
- `readSnapshot` defaults a null/absent `browser` column to `"chromium"`, so
  baselines captured before this feature stay diffable.
- An invalid value fails Zod validation and exits 2, consistent with all other
  config errors.
- Playwright's `chrome` is **not** a separate engine — it is Chromium launched
  against the branded Google Chrome channel — so the branded channel is out of
  scope. `chromium` already covers Blink.
- One engine per baseline. Multi-browser baselines in a single DB would need a
  different key structure and stay out of scope
  ([ADR-0009](0009-baseline-in-same-db.md)).
