# RFC-0009: The 1.0 stability contract

**Status:** Accepted · **Milestone:** 1.0 · **Created:** 2026-10-16

## Summary

Define exactly what momus 1.x promises not to break, how anything else changes
over time, and the work to make those promises keepable. 1.0 is tagged when
this RFC's checklist and every milestone M1 to M6 are done.

## Motivation

Visual regression testing sits in CI pipelines and holds long-lived baselines. A
release that breaks a config file, a flag, or a stored baseline costs every user
a broken pipeline, and a re-baseline that throws away their history. People
will build on momus once they can rely on it.

## Today

- 0.x: anything may change.
- The config is validated with Zod ([schema.ts](../../src/config/schema.ts)).
  The only programmatic export is `defineConfig` plus the config types
  ([index.ts](../../src/index.ts)).
- Flags are registered globally, so a flag is accepted by commands that ignore
  it ([AGENTS.md](../../AGENTS.md)). `snapshot --snapshot` is the known case.

## Proposal

### What semver covers in 1.x

| Surface | Promise |
| --- | --- |
| **Config schema** | A valid 1.0 config stays valid and behaves the same. New fields are optional with defaults. |
| **CLI** | Commands, flags, and their meanings are stable. Exit codes 0, 1 and 2 keep the meanings in [ADR-0006](../adr/0006-errors-are-rows.md). |
| **`.sqlite` format** | Every 1.x release opens, migrates, and diffs against a baseline written by any earlier 1.x release ([RFC-0002](0002-storage-and-run-history.md)). |
| **JSON results** | A versioned schema ([RFC-0008](0008-cli-ci-integration.md)). Fields are only added within a major version. |
| **Programmatic API** | Whatever `src/index.ts` exports at 1.0. |
| **Docker image** | The entrypoint, the `/work` mount, and tags `:1`, `:1.x`, `:1.x.y`. |

### What it doesn't cover

- **Pixels across releases.** Upgrading Playwright or the base image can change
  rendering. Every release records its engine version on each run. A release
  that bumps the engine's version says so in the changelog, and the
  compatibility gate refuses a baseline captured with a different engine
  version ([ADR-0010](../adr/0010-baseline-compatibility-gate.md)), so the
  upgrade costs a `momus snapshot` rather than a run of false diffs.
- **Reading 1.x databases from 2.x.** The 2.0 server imports a 1.x `.sqlite`
  once ([RFC-0010](0010-server.md)); the 2.x CLI need not open one directly.
- The HTML report's markup, log text, and progress output.
- Anything under `src/` that `index.ts` doesn't export.

### Deprecation policy

A deprecated config field or flag keeps working with a warning to stderr for
at least one minor release, and is removed only in the next major. The
changelog has a "Deprecated" section in every release.

### Work to reach the contract

- **Validate flags per command.** An unknown or inapplicable flag is an error,
  not ignored. This supersedes the "flags are registered globally" invariant,
  so it needs an ADR.
- **Reject unknown config keys.** Use a strict Zod object with a "did you mean"
  suggestion, so typos fail loudly instead of being silently ignored.
- **Decide the programmatic API.** Either `runFlow` with injectable seams, or
  `defineConfig` only. Anything exported is supported for all of 1.x.
- **Documentation:** a docs site, or at least `docs/`, covering every config
  field, every command, and the CI recipes. The README stays a quick start.
- **Changelog:** keep a changelog from the first M1 release, using Keep a
  Changelog sections, rather than relying only on generated release notes.
- **Compatibility tests:** check in a fixture `.sqlite` for every minor release
  from 1.0 onward. CI opens and diffs each one.
- **Gate the engine version.** Snapshots already record it; the compatibility
  gate compares it and refuses a mismatch with a message that names both
  versions and says to re-snapshot. Baselines recorded before the change need
  a backward-compatible reading, so it needs an ADR.

### Release cadence

Release candidates (`1.0.0-rc.N`) for at least two weeks before 1.0.0, with the
contract frozen. Only fixes land during that window.

## Non-goals

- Long-term-support branches. 1.x gets fixes on the latest minor only.

## Open questions

- ~~Should the `.sqlite` promise cover *reading* 1.x DBs from 2.x, or is 2.0
  allowed to require a one-time export or import into the server?~~ Resolved
  on 2026-10-20: a one-time import into the server is enough. See What it
  doesn't cover.
- ~~Should engine-version drift be a warning or a hard gate? A hard gate is
  correct but forces a re-baseline on many routine upgrades.~~ Resolved on
  2026-10-20: a hard gate. See What it doesn't cover and Work to reach the
  contract.

## Done when

- [ ] Milestones M1 to M6 are shipped.
- [ ] Flags are validated per command and unknown config keys are rejected,
      each with an ADR.
- [ ] The engine version is gated, with an ADR.
- [ ] The public API is decided and documented.
- [ ] The documentation covers every field, command and recipe.
- [ ] A changelog, a deprecation policy, and compatibility fixture tests are in
      CI.
- [ ] RC period completed.
