# ADR-0026: The prod origin joins the compatibility gate

**Date:** 2026-10-17 · **Status:** Accepted · **Amends:** [ADR-0010](0010-baseline-compatibility-gate.md), [ADR-0020](0020-run-snapshot-flag.md)

## Context

[ADR-0010](0010-baseline-compatibility-gate.md)'s gate never compared the
baseline's `prod_base_url` with `config.prod`. A DB pointed at a second site
diffed against the first site's baseline and produced a clean-looking report of
garbage. [ADR-0020](0020-run-snapshot-flag.md) recorded the same gap from
another side: `--prod` on `run` was silently ignored once a baseline existed.

## Decision

`baselineConflict` compares the prod **origin** (scheme + host + port) first,
before browser, viewports and stabilize. Origins, not full URLs, so a trailing
slash or a path on the base URL isn't read as another site. The message names
both origins and both fixes: re-capture with `momus run --snapshot` (or
`momus snapshot`), or point `output.db` at a separate file.

- The same check closes the `--prod` gap: `--prod` overrides `config.prod`, so a
  mismatching `--prod` is now a conflict (exit 2) instead of a no-op.
- `run --snapshot` re-materializes from the new origin before the gate runs, so
  it never conflicts.
- `momus snapshot --snapshot` is rejected at parse time ("unknown flag for
  snapshot"). It is the one exception to globally registered flags, because it
  reads like it does something; general per-command validation is left to
  RFC-0009.

## Consequences

- No backward-compatible default is needed: `snapshot.prod_base_url` has been
  `NOT NULL` since the first release, so every existing baseline carries it.
- Changing prod's scheme or port (`http` → `https`) is a conflict too. That is
  correct: it's a different capture, and the fix is one flag.
