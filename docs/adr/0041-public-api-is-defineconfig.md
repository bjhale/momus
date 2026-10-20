# ADR-0041: The 1.x programmatic API is `defineConfig` and the config types

**Date:** 2026-10-20 · **Status:** Accepted

## Context

[RFC-0009](../rfcs/0009-stability-contract.md) makes whatever `src/index.ts`
exports at 1.0 a promise for all of 1.x. Two shapes were on the table:

- **`defineConfig` only**, as today, plus the `RawConfig` and `ResolvedConfig`
  types.
- **Also `runFlow`**, with its injectable seams (`discover`, `captureProd`,
  `getDev`, `diffPool`, …), so momus could be embedded in other tools.

## Decision

`defineConfig` and the two config types, nothing else. The CLI and the Docker
image are the product. `tests/index.test.ts` fails if anything else is
exported, so a new export is a deliberate contract change.

## Consequences

- `runFlow`, the pipeline seams, the store helpers and the diff worker stay
  internal. They can be reshaped in any 1.x release, which the 2.0 server work
  ([RFC-0010](../rfcs/0010-server.md)) is likely to need.
- Embedding momus means running the CLI (or the image) and reading its exit
  code and output. A machine-readable result is RFC-0008's job, not an API.
- `RawConfig` and `ResolvedConfig` are covered by the config schema promise:
  new optional fields may appear in a minor release; nothing is removed or
  narrowed before 2.0.
- Exporting more later is additive and allowed in a minor release. Taking
  something away is not, which is why starting small is the safe direction.
