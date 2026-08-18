# ADR-0005: Async pool for capture, worker threads for diffing

**Date:** 2026-07-03 · **Status:** Accepted

## Context

The two expensive stages of a run have opposite performance characteristics.
Screenshotting waits on a browser that renders in its own processes — momus code
just awaits. Pixel diffing is pure computation in-process. Running both the same
way would either leave the browser underutilized or block the event loop.

## Decision

Split them:

- **Capture** runs as N concurrent async operations via `mapWithConcurrency`
  (`src/pipeline/queue.ts`). Bounded by `concurrency.screenshots`.
- **Diffing** runs in a pool of K Bun **Worker threads**
  (`src/diff/pool.ts`). Bounded by `concurrency.diffWorkers`.
- **All SQLite writes stay on the main thread.** Workers return buffers by
  message; the main thread persists them.

`--concurrency N` maps to the screenshot pool only — the usual bottleneck and
the knob users reach for on the command line. `diffWorkers` is config-only.

## Consequences

- Running `pixelmatch` inline would block Bun's event loop and stall every
  in-flight capture. The worker pool is what keeps the two stages independent.
- The main-thread write rule respects SQLite's single-writer model without
  needing locking or a second connection (see
  [ADR-0002](0002-sqlite-blobs-single-run-db.md)).
- Backpressure is inherent: bounded concurrency plus flush-as-you-go means only a
  handful of PNG pairs are resident at once, regardless of site size.
- A crashed worker is detected by the pool, which marks that comparison errored
  and respawns a replacement rather than failing the run
  ([ADR-0006](0006-errors-are-rows.md)).
