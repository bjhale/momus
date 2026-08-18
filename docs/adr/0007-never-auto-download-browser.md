# ADR-0007: `run` never downloads a browser

**Date:** 2026-07-03 · **Status:** Accepted

## Context

Playwright can fetch its browser binaries on demand. Doing that lazily inside
`momus run` would make first use frictionless — and would also mean a CI job
silently pulling hundreds of megabytes mid-run, at unpredictable times, possibly
behind a proxy that blocks it.

## Decision

`momus install-browser` is the **only** command that downloads anything. Every
other command checks up front whether the configured engine is present and, if
not, prints a message naming that engine and pointing at `install-browser`, then
exits `2`.

## Consequences

- CI failures are explicit and fast instead of appearing as a mysterious stall.
- Config must be loaded and resolved **before** the presence check, since the
  config determines which engine to look for
  ([ADR-0019](0019-selectable-browser-engine.md)). Both commands are ordered that
  way.
- The Docker image sidesteps the issue entirely by baking all three engines in at
  build time.
