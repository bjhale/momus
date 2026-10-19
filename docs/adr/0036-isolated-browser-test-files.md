# ADR-0036: Browser test files that destabilize the shared process run isolated

**Date:** 2026-10-18 · **Status:** Accepted · **Amends:** [ADR-0031](0031-per-engine-test-processes.md)

## Context

RFC-0006's determinism tests and flake benchmark launch Chromium against
fixture servers with deliberately slow or never-answered responses. In the
shared `bun test` process they made a later `browser.close()` hang until the
hook timed out, in whichever file closed next. `ps` showed Chromium had exited;
Bun never settled the close. Bisecting: the file alone, clean; with the rest
of `tests/capture`, a hang on every run. It was not one test: any five of the
six passed, so it accumulates. The same Bun child-process weakness is behind
ADR-0031 and the "one browser per file" convention.

## Decision

**A file like this runs only when `MOMUS_ISOLATED` names it**, via
`isolated(name)` in `tests/helpers/engines.ts`, and is skipped otherwise.
`bun run test` chains `test:isolated`, which runs each such file in its own
process: `determinism` and `flake` today.

## Consequences

- A new isolated file must be added to `test:isolated` by hand, as with
  `test:engines`.
- A plain `bun test` skips these files; `bun run test` is the full suite.
- The scenario and baseline e2e files still flake on this host at about the
  rate they did before RFC-0006 (Chromium's devtools pipe dropping mid-run).
  That predates this work and isn't addressed here.
