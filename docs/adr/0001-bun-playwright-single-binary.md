# ADR-0001: Bun + Playwright, shipped as a binary but containerized from source

**Date:** 2026-07-03 · **Status:** Accepted

## Context

momus needs a real browser engine to capture screenshots and wants to ship as
something a user can drop onto a machine or into CI without a runtime install.
Bun offers `bun build --compile` (single-file binary), a built-in test runner,
and built-in SQLite. Playwright is the most capable capture library but normally
spawns a driver process and resolves its own packages at runtime.

Whether Playwright survives `--compile` was the project's single largest
technical risk, so it was de-risked first, before any feature work.

## Decision

Build on Bun + TypeScript. Capture with Playwright, isolated behind
`src/capture/screenshot.ts` so the engine could be swapped for `puppeteer-core`
without touching anything else.

Ship two ways, and accept that they differ: `bun build --compile` for the
standalone binary, and a **Docker image that runs from source** (`bun` +
`node_modules`) rather than from that binary.

## Consequences

- Playwright cannot be fully bundled — at runtime it dynamically resolves
  `playwright-core` from `node_modules`, so a standalone binary still needs
  `node_modules` beside it. Source mode in the container sidesteps this and is
  exactly the path the test suite exercises.
- The Docker base image tag (`mcr.microsoft.com/playwright:vX`) must track the
  `playwright` version in `bun.lock`. Bump them together or the baked-in browsers
  stop matching.
- `bun:sqlite`, `bun:test`, and `Bun.serve` are used directly; momus is
  Bun-only by construction, which also lets it use Bun-specific APIs like
  per-request `tls` options in `fetch` (see [ADR-0016](0016-insecure-tls-flag.md)).
