# Stability

momus 0.x may change anything. From 1.0 on, what's listed here keeps working
across every 1.x release ([RFC-0009](rfcs/0009-stability-contract.md)).

## What 1.x promises

| Surface | Promise |
| --- | --- |
| **Config** | A valid 1.0 config stays valid and behaves the same. New fields are optional, with defaults. An unknown key is an error, so "valid" is exact ([ADR-0040](adr/0040-strict-config.md)). |
| **CLI** | Commands, their flags, and what they mean are stable. Exit codes `0`, `1` and `2` keep their meanings ([cli.md](cli.md#exit-codes)). A command rejects flags it doesn't take ([ADR-0039](adr/0039-flags-per-command.md)). |
| **`.sqlite`** | Every 1.x release opens, migrates and diffs against a baseline written by any earlier 1.x release. A fixture DB from each minor release is checked in and diffed in CI. |
| **Programmatic API** | `defineConfig` and the `RawConfig` / `ResolvedConfig` types, and nothing else ([ADR-0041](adr/0041-public-api-is-defineconfig.md)). |
| **Docker image** | The entrypoint, the `/work` mount, and the tags `:1`, `:1.x` and `:1.x.y`. |

## What it doesn't cover

- **Pixels across releases.** Upgrading Playwright or the base image can change
  rendering. Each baseline records its browser engine version, and a run with a
  different version is refused with a message to re-capture
  ([ADR-0038](adr/0038-engine-version-in-the-gate.md)). The changelog says when
  a release changes the browser version, which means re-capturing every
  baseline.
- **Reading 1.x databases from 2.x.** The 2.0 server imports a 1.x `.sqlite`
  once ([RFC-0010](rfcs/0010-server.md)); the 2.x CLI need not open one
  directly.
- The HTML report's markup, log text, and progress output.
- Anything under `src/` that `src/index.ts` doesn't export, including the
  pipeline and its seams.

## Deprecation policy

A deprecated config field or flag keeps working, with a warning on stderr, for
at least one minor release, and is removed only in the next major. Every
release's [changelog](../CHANGELOG.md) has a `Deprecated` section, even when it
says "Nothing."

1.x gets fixes on its latest minor only; there are no long-term-support
branches.
