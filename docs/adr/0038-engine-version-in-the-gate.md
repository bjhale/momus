# ADR-0038: The browser engine version joins the compatibility gate

**Date:** 2026-10-20 · **Status:** Accepted

## Context

A browser upgrade changes rendering: font hinting, antialiasing, layout
rounding. Diffing a dev capture from one Chromium build against a baseline from
another reports changes that no one made. RFC-0006 left the question open, and
[RFC-0009](../rfcs/0009-stability-contract.md) settled it: pixels across
releases are not covered by semver, so a mismatched engine must be caught
rather than diffed.

Runs already recorded their engine version, but the baseline did not.

## Decision

- **Migration v6** adds `snapshot.engine_version`. Every baseline capture
  (`momus snapshot`, a first `momus run`, `momus run --snapshot`) records
  `browser.version()`.
- **The gate refuses a mismatch** ([ADR-0010](0010-baseline-compatibility-gate.md)):
  the run's engine version must equal the baseline's, exactly. The message names
  both versions and says to re-capture. It is checked after the engine name and
  before the rendering environment.
- **Unknown is not compared.** A baseline written before v6 has no version, and
  it can't be recovered: `momus snapshot` records no run, so there is nothing
  to backfill from. Such a baseline stays diffable until it is next captured,
  which then records the version. A caller that doesn't know its own version
  (the tests' seams) isn't compared either.
- A run's recorded baseline identity includes the engine version when known.

## Consequences

- Every Playwright or Docker image bump that changes the browser build forces
  one `momus snapshot` (or `momus run --snapshot`) per site, instead of a run of
  false diffs. The changelog says when a release does this
  ([RFC-0009](../rfcs/0009-stability-contract.md)).
- An exact string match also refuses patch-level browser updates. That is
  deliberate: a patch can change rendering too, and there is no reliable way to
  know which ones do.
- An upgraded momus with an old baseline doesn't catch an engine change on its
  first run; that baseline's version is unknown. The protection starts from its
  next capture.
