# ADR-0031: Each non-default browser engine's tests run in their own process

**Date:** 2026-10-17 · **Status:** Superseded by [ADR-0036](0036-bun-1-4-3-one-test-process.md)

## Context

RFC-0004 needs scenarios proven on all three engines. The first version looped
over chromium, firefox and webkit inside one `bun test` process. Later
Playwright launches then failed intermittently with Bun's spawn error "Failed to
connect ENOENT". Bisecting: chromium alone, 6 of 6 runs clean; firefox alone, 6
of 6 clean; mixed in one process, about one run in two failed. Launching Firefox
in the shared process poisons later launches.

## Decision

Multi-engine tests loop over `TEST_ENGINES` from `tests/helpers/engines.ts`. It
reads `MOMUS_ENGINE` and defaults to `["chromium"]`. `bun run test` runs the
whole suite on chromium, then chains `test:engines`, which runs the multi-engine
files once for firefox and once for webkit, each in its own process.

`launchable(engine)` skips an engine whose binary is installed but can't launch,
such as WebKit without its system libraries on WSL. That is an environment gap,
not a regression.

## Consequences

- A new multi-engine test file must be added to `test:engines` in `package.json`
  by hand. Forgetting it means it only ever runs on chromium.
- A full run is a little slower: three short `bun test` invocations rather than
  one.
- If Bun fixes the spawn bug, the loop can go back in-process and
  `test:engines` can go away.
