# ADR-0039: Each command accepts only its own flags

**Date:** 2026-10-20 · **Status:** Accepted

## Context

Every flag was registered for every command, so `momus snapshot --dev URL` or
`momus report --crawl` parsed and did nothing. A flag that is silently ignored
reads as if it worked, which is worse than an error, and under the 1.x contract
([RFC-0009](../rfcs/0009-stability-contract.md)) it would become behavior
people rely on. `snapshot --snapshot` was rejected by a special case
([ADR-0026](0026-prod-origin-in-the-gate.md)); every other mismatch passed.
Stray positional arguments (`momus run extra`) were ignored the same way.

## Decision

- `COMMAND_FLAGS` in `src/cli.ts` lists the flags each command takes. `parseArgs`
  runs in strict mode over only that command's flags.
- A flag the command doesn't take fails at parse time (exit 2):
  `unknown flag for snapshot: --dev (it is a flag of run)`, naming the
  commands that do take it, when any do. `snapshot --snapshot` is now just one
  instance of this rule.
- A positional argument is an error: `unexpected argument for run: extra`.
- The usage text is generated from `COMMAND_FLAGS`, so it can't drift from
  what parses.

## Consequences

- This replaces AGENTS.md's "flags are registered globally" invariant. A new
  flag must be added to `COMMAND_FLAGS` for each command that reads it, or that
  command rejects it.
- A script that passed a harmless extra flag to one command breaks. This is a
  0.x change, made before the 1.0 freeze for that reason.
- Flag precedence over config values is unchanged.
