# ADR-0040: Unknown config keys are an error, with a suggestion

**Date:** 2026-10-20 · **Status:** Accepted

## Context

Zod objects strip unknown keys by default, so `viewport: [375]` or
`stabilize: { maks: [...] }` parsed cleanly and did nothing: the run used the
default viewports and masked nothing, and the only sign was a report that
looked wrong. `defineConfig` catches typos in a typed `momus.config.ts`, but not
in a JSON config, a `.js` config, or a spread of untyped values. Under the 1.x
contract ([RFC-0009](../rfcs/0009-stability-contract.md)) a valid config must
behave the same in every 1.x release, so "valid" has to mean something before
1.0.

## Decision

- Every config object is `.strict()`: the root, `discovery`, the `crawl`
  object, `stabilize`, `diff`, each `diff.overrides` entry, `concurrency`,
  `output`. Scenarios, setup and steps already were.
- `resolveConfig` reports each unknown key on its own line with its full path,
  and the closest known key at that path when one is close enough
  (`src/config/suggest.ts`: case-insensitive edit distance, at most
  max(2, ⌊length/3⌋)): `stabilize.maks: unknown key; did you mean "mask"?`. No
  suggestion is better than a wrong one, so a distant typo gets none.
- A typo inside a union (`crawl: true | { ... }`) is reported as the object
  branch's issue, not Zod's "invalid input".
- `discovery.crawl.maxPages`, which earlier 0.x releases tolerated and ignored
  after it moved, is now an error that says where it went
  (`discovery.maxPages`).

## Consequences

- A config with a stray key that used to load now fails with exit 2. That is
  the point, and it lands before 1.0 so 1.x never has to keep honoring it.
- New config fields must be added to the schema before they can be used, even
  experimentally. Removing a field later goes through the deprecation policy
  (warn for a minor, remove in a major) rather than silently ignoring it.
