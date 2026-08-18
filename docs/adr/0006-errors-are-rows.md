# ADR-0006: Failures become rows, and errors exit non-zero

**Date:** 2026-07-03 · **Status:** Accepted

## Context

Any page in a run can fail independently: a 404 on one side, a navigation
timeout, a DNS failure, a crashed diff worker. A run over hundreds of pages that
aborts on the first such failure is close to useless.

There is also a reporting question. If a page fails to load, is that a pass (no
diff was detected) or a failure?

## Decision

**One bad page never aborts a run.** Every failure is recorded as a comparison
row with `status='error'` and a message, and surfaced in the report as an error
card. The run continues.

**An error is a regression signal.** `exitCodeFor` returns `1` for a
`status='error'` row just as it does for a page that failed its diff gate. Exit
`2` is reserved for operational failures that prevented the run from happening at
all — no browser, invalid config, discovery threw, baseline conflict.

## Consequences

- momus is CI-gateable on the exit code alone, even though HTML is the primary
  output: `0` clean, `1` something regressed or broke, `2` momus itself couldn't
  run.
- A page that silently stopped resolving cannot masquerade as "no visual change".
- Rows are created early with null images so the report can say "this page failed
  on dev" rather than dropping the page without trace.
- `momus snapshot` is the deliberate exception: individual prod capture failures
  become error rows in `baseline_images` and it still exits `0`, because the
  baseline write itself succeeded. See
  [ADR-0011](0011-run-always-diffs-a-baseline.md) for the open question this
  creates when every capture fails.
