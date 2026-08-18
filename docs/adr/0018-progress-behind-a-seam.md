# ADR-0018: Progress bars behind a three-method seam, rendered to stderr

**Date:** 2026-07-05 · **Status:** Accepted

## Context

A `run` or `snapshot` printed nothing until its final summary. On a large site
that looks hung for minutes. The per-page work runs through
`mapWithConcurrency` in both pipelines, and the job total is known as soon as
jobs are built, so a determinate bar is possible.

## Decision

Use `cli-progress`, but never let the pipelines see it. They depend on a
three-method interface (`src/progress.ts`):

```ts
interface Progress { start(total, label): void; tick(): void; stop(): void }
```

- **Render to stderr**, so piping stdout still yields clean summary output.
- **Sequential per-phase bars**, reusing one instance: `snapshot` shows
  "Capturing prod"; a reused-baseline `run` shows "Capturing dev + diffing"; a
  materializing `run` shows both in sequence.
- **Non-TTY emits periodic plain lines** (cli-progress `noTTYOutput`), not
  carriage-return redraw spam, so CI logs stay readable.

## Consequences

- `progress` is optional on both pipelines; `undefined` means today's silent
  behavior, which is what the existing unit tests pass. Tests inject a fake
  recorder and assert `start` once with `total === jobs.length`, one `tick` per
  job, one `stop`.
- The tick fires in a `finally` around each job so it advances on error paths
  too and the bar always reaches 100% ([ADR-0006](0006-errors-are-rows.md)).
- `stop()` is only called on normal completion. If the map throws, the bar is
  left dangling — acceptable, since the process is exiting with an error anyway.
  Progress calls are deliberately kept out of the catch path.
- **Discovery is not barred.** Its total is unknowable mid-crawl and it is fast.
  Zero jobs never shows an empty bar, because discovery throws "no pages
  discovered" before any bar starts.
- No `--quiet` / `--no-progress` flag — cli-progress adapts to TTY vs non-TTY
  itself. Easy to add later if wanted.
