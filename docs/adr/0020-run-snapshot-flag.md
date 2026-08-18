# ADR-0020: `momus run --snapshot` re-captures the baseline in one invocation

**Date:** 2026-08-18 · **Status:** Accepted · **Amends:** [ADR-0011](0011-run-always-diffs-a-baseline.md)

## Context

[ADR-0011](0011-run-always-diffs-a-baseline.md) froze the baseline after first
use and deliberately added **no** refresh flag, on the grounds that
`momus snapshot` already covered it (YAGNI).

In practice that means two invocations — and under Docker, two container
launches — for the common "re-capture prod, then diff" cycle. It also leaves no
single-command way out of a baseline that froze wrong (for example one
materialized while prod was unreachable, the open question in ADR-0011).

The flag was first implemented as `--fresh`, justified by reusing one disposable
`output.db` across different sites. That justification was withdrawn: the
intended shape is **one DB per site**, configured through per-site config files
that each set their own `output.db`.

## Decision

Overturn the no-flag call. Add `momus run --snapshot`: re-discover and re-capture
prod into the baseline, ignoring the freeze, then diff — equivalent to running
`momus snapshot` first, in a single invocation.

Named `--snapshot` to match the command that does the same work. The internal
field on both `ParsedCli` and `RunFlowArgs` is **`forceSnapshot`**, because
`snapshot` already names both the subcommand and the baseline row that
`runFlow` reads a few lines away from where the flag is checked.

## Consequences

- One line changes in the flow: `if (!snapshot || args.forceSnapshot)`. Every
  freeze guarantee in ADR-0011 is intact when the flag is absent.
- Documented as a refresh shortcut, **not** as a way to share one DB between
  sites.
- The flag is registered globally in `parseArgs`, so `momus snapshot --snapshot`
  parses and does nothing. Consistent with `--dev` being accepted on `snapshot`
  today, but it is noise.
- **Known gap this does not close.** The compatibility gate still ignores
  `prod_base_url` ([ADR-0010](0010-baseline-compatibility-gate.md)), so pointing
  a DB at a second site silently diffs against the first site's baseline. This
  flag is only a manual remedy — you have to remember it. Adding `prod_base_url`
  to `baselineConflict` would make forgetting it loud instead of silent, and
  remains the recommended follow-up.
- Related: `--prod` on `run` is already a silent no-op when a baseline exists, as
  prod comes from the baseline. The same gate would cover that too.
