# Design: progress bars

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Problem

A `momus run`/`snapshot` prints nothing while it captures and diffs — only the
final summary lines. On a large site the run looks hung. We want live progress,
rendered as **progress bars**.

## Decisions (from brainstorming)

1. **Dependency-based bar:** use the `cli-progress` library (not hand-rolled).
2. **Non-TTY:** emit **periodic plain lines** (not `\r` redraw spam) in CI/piped
   output — via cli-progress's non-TTY mode.
3. **Per-phase bars, sequential.** A first (materializing) run shows two bars in
   sequence (prod capture, then dev capture + diff), not one merged bar.
4. **Render to stderr** so piping stdout still yields clean summary/report output.

## Work being tracked

The per-page work runs through `mapWithConcurrency` in two pipelines:

- `snapshotPipeline` — captures prod for each `path × viewport` job.
- `runPipeline` — captures dev and diffs for each `path × viewport` job.

`runFlow` orchestrates a run: it may materialize a baseline (`snapshotPipeline`)
and then always runs `runPipeline`. The job total is known right after the jobs
are built, so a determinate bar is possible. Discovery (sitemap/crawl) is **not**
barred — its total is unknowable mid-crawl and it is fast.

## 1. Dependency + `Progress` seam

Add `cli-progress` (runtime dep) and `@types/cli-progress` (dev dep). The
`node_modules` is already bundled into the Docker image, so it ships without
extra work.

To keep the pipelines decoupled from the library and unit-testable, they depend
on a tiny interface, not on cli-progress directly:

```ts
// src/progress.ts
import { SingleBar } from "cli-progress";

export interface Progress {
  /** Begin a phase with a known total and a human label. Reusable across phases. */
  start(total: number, label: string): void;
  /** Advance by one completed unit. */
  tick(): void;
  /** Finish the current phase. */
  stop(): void;
}

/** A cli-progress-backed Progress rendering to `stream` (stderr by default).
 * Non-TTY output is periodic plain lines (noTTYOutput), not carriage-return
 * redraws, so CI logs stay readable. */
export function makeProgress(stream: NodeJS.WritableStream = process.stderr): Progress {
  const bar = new SingleBar({
    format: "{label} [{bar}] {percentage}% | {value}/{total}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
    stream,
    noTTYOutput: true,     // emit in non-TTY environments...
    notTTYSchedule: 2000,  // ...as a line every ~2s
  });
  return {
    start(total, label) { bar.start(total, 0, { label }); },
    tick() { bar.increment(); },
    stop() { bar.stop(); },
  };
}
```

Notes:
- `stream` is injectable so tests can render into a `PassThrough` instead of the
  real stderr.
- One `SingleBar` instance is reused across phases (`start → stop → start`);
  cli-progress explicitly supports reuse.
- `{label}` is a payload token set via `start(total, 0, { label })`.

## 2. Pipeline hooks

Both pipelines gain an optional `progress?: Progress`. `undefined` = today's
behavior (no bar) — which the existing pipeline unit tests pass.

`src/pipeline/snapshot.ts` (`SnapshotPipelineArgs` gains `progress?: Progress`):
after building `jobs`, `args.progress?.start(jobs.length, "Capturing prod")`;
tick once per job; `args.progress?.stop()` after the map. The tick fires in a
`finally` around each job so it advances on both success and error.

`src/pipeline/run.ts` (`RunPipelineArgs` gains `progress?: Progress`): after
`const jobs = await args.listJobs()`,
`args.progress?.start(jobs.length, "Capturing dev + diffing")`; tick once per job
(wrap the existing per-job try/catch in an outer `try { … } finally {
args.progress?.tick(); }` so every job — including early-return error branches —
ticks exactly once); `args.progress?.stop()` after the map.

`stop()` is only called on the normal-completion path (after the map). If the map
throws (discovery/fan-out failure), the existing terminal-status/`throw` path is
unchanged; a dangling bar is acceptable there (the process is exiting with an
error). Do not add progress calls to the catch path.

## 3. Phases the user sees

- `momus snapshot` → one bar: **Capturing prod**.
- `momus run`, baseline reused → one bar: **Capturing dev + diffing**.
- `momus run`, first run (materialize) → two sequential bars: **Capturing prod**,
  then **Capturing dev + diffing** (the same `Progress` is reused).

## 4. Wiring

`runFlow` (`RunFlowArgs`) gains `progress?: Progress` and forwards it to
`snapshotPipeline` (materialize branch) and `runPipeline`.

Both commands create the bar and pass it through:
- `src/commands/run.ts`: `const progress = makeProgress();` → `runFlow({ …, progress })`.
- `src/commands/snapshot.ts`: `const progress = makeProgress();` → `snapshotPipeline({ …, progress })`.

Always created — cli-progress adapts to TTY vs non-TTY internally. No
`--no-progress`/`--quiet` flag in this iteration (YAGNI; easy to add later).

The existing final summary lines (`console.log` to stdout) are unchanged and
still print after the bar's `stop()`.

## 5. Edge cases

- **Non-TTY (CI/pipe):** periodic plain lines via `noTTYOutput`; stdout summary
  unaffected.
- **Zero jobs:** discovery throws `"no pages discovered"` before any bar starts,
  so no empty bar is shown.
- **Per-job errors:** still tick (finally), so the bar reaches 100%.
- **Map throws:** bar not stopped; process exits with an error anyway — acceptable.

## 6. Testing

- **Pipelines** (`tests/pipeline/run.test.ts`, `tests/pipeline/snapshot.test.ts`):
  pass a fake `Progress` recorder `{ starts: [], ticks: 0, stops: 0 }`; assert
  `start` called once with `total === jobs.length` and the expected label, `tick`
  called exactly once per job (including error jobs), `stop` called once.
- **`makeProgress`** (`tests/progress.test.ts`): render into an injected
  `PassThrough`; drive `start(2, "Test") → tick() → stop()`; assert the captured
  output contains the label (`"Test"`) and a `value/total` fragment (`"1/2"` or
  `"2/2"`). If cli-progress does not flush to a non-TTY `PassThrough` on `stop`,
  fall back to asserting `makeProgress()` returns an object whose `start`/`tick`/
  `stop` are callable functions that do not throw.
- No real-Chromium test.

## 7. Docs

- README: a short note under "How it works" / usage that runs render a progress
  bar to stderr (periodic lines in non-TTY). No config surface to document.
- `package.json` gains the `cli-progress` dependency (+ `@types/cli-progress`
  dev); no Dockerfile change needed (it bundles `node_modules`).

## Out of scope

- A `--no-progress` / `--quiet` flag or a config field.
- A discovery-phase bar (unknown total) — a spinner/line could come later.
- ETA/throughput columns (the format is intentionally minimal).
- Multi-bar concurrent display (phases are sequential).
