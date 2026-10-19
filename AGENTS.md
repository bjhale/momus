# AGENTS.md

Orientation for coding agents working in this repo. Humans should start with
[README.md](README.md) (usage) and [CONTRIBUTING.md](CONTRIBUTING.md) (setup and
release).

## What momus is

A CLI that screenshots two deployments of the same site (dev and prod), diffs
them page by page at several viewport widths, and writes a self-contained HTML
report. Bun + TypeScript, Playwright for capture, `bun:sqlite` for storage,
`pixelmatch` for diffing.

[docs/architecture.md](docs/architecture.md) is the map — pipeline, module
responsibilities, the four-table schema, config resolution, exit codes. Read it
before changing anything structural. [docs/adr/](docs/adr/) has the reasoning
behind specific choices; check for a relevant record before proposing to undo
something that looks odd.

## Commands

```bash
bun run test                         # whole suite (~420 tests); adds --timeout, as CI does;
                                     # then `test:isolated` runs each MOMUS_ISOLATED browser file in its
                                     # own process (ADR-0036);
                                     # then `test:engines` reruns the multi-engine tests for firefox and
                                     # webkit, each in its own process (Bun breaks on two engines in one)
bunx tsc --noEmit                    # typecheck
bun run src/cli.ts <command>         # run momus from source (or: bun momus)
bun run src/cli.ts install-browser   # needed once before browser-guarded tests
bun run build:dev                    # docker build -t momus-dev .
```

Run **both** `bun run test` and `bunx tsc --noEmit` before claiming work is done.
Neither is slow enough to skip.

## Invariants

Break these and the tool is subtly wrong rather than obviously broken:

- **One bad page never aborts a run.** Per-page failures become comparison rows
  with `status='error'` and a message. Do not let a capture, diff, or selector
  problem throw out of the per-job handler. ([ADR-0006](docs/adr/0006-errors-are-rows.md))
- **Exit codes mean specific things.** `0` all passed; `1` something failed the
  gate *or* errored; `2` operational failure that prevented the run. An error is
  never a silent pass.
- **All SQLite writes happen on the main thread.** Workers return buffers by
  message. ([ADR-0005](docs/adr/0005-split-concurrency-model.md))
- **Never scale images to reconcile dimensions — pad them.** Scaling resamples
  every pixel and destroys the comparison. ([ADR-0003](docs/adr/0003-pad-never-scale.md))
- **`run` never downloads a browser.** Only `install-browser` does.
  ([ADR-0007](docs/adr/0007-never-auto-download-browser.md))
- **Anything that changes captured pixels must join the baseline compatibility
  gate** in `src/pipeline/compat.ts` — and needs a backward-compatible default
  (`?? []`, `?? "chromium"`) so baselines captured before the change stay
  diffable. ([ADR-0010](docs/adr/0010-baseline-compatibility-gate.md))
- **Every schema change is a new migration** in `src/store/migrations.ts`.
  Never edit a released step, and keep `tests/fixtures/db/v0.9.4.sqlite` opening
  and diffing. ([ADR-0024](docs/adr/0024-versioned-schema-migrations.md))
- **CLI flags beat config-file values beat defaults.** Flags are registered
  globally in `parseArgs`, so a flag only one command reads is still accepted by
  the others. The one exception is `momus snapshot --snapshot`, rejected at parse
  time ([ADR-0026](docs/adr/0026-prod-origin-in-the-gate.md)).

## Testing conventions

The suite runs with no browser and no network almost everywhere. That is
deliberate — preserve it. Test behind the existing seams instead of reaching for
a real browser:

- `runPipeline` takes `listJobs` / `getDev` / `getProd` as injected functions.
- `discoverPaths` takes injectable sitemap, crawl, and file-read functions.
- `makeFetcher` takes an injectable `fetch`.
- `Progress` is a three-method interface, not the `cli-progress` object.

Tests needing a real page are guarded with
`isBrowserInstalled() ? test : test.skip`. `tests/` mirrors `src/`. End-to-end
tests serve fixtures from `tests/fixtures/` via `Bun.serve`.

## Code conventions

- **Every source file opens with a `// src/path/to/file.ts` comment.** No
  exceptions in `src/` except the `.d.ts`.
- Comments explain *why*, not what — the existing density is high where a choice
  is non-obvious and absent where the code is plain. Match it.
- Pure logic separates from I/O: parsers, matchers, and scorers are standalone
  functions; browser and network access sit behind interfaces.
- Zod owns config validation and defaults. Don't hand-roll fallbacks that
  duplicate a schema default.

## Recording decisions

When you make a call a future reader would have to reverse-engineer — a
trade-off, a rejected alternative, a deliberate constraint — add an ADR in
[docs/adr/](docs/adr/) and a row to its index. Records are immutable once
accepted: supersede with a new one and cross-link, never edit history.
`docs/superpowers/` is gitignored scratch space, not documentation.

Planned work is in [ROADMAP.md](ROADMAP.md), with one RFC per feature in
[docs/rfcs/](docs/rfcs/). RFCs are editable proposals; ADRs are the decisions
they leave behind. If a task touches a roadmap feature, read its RFC first, and
don't build anything that contradicts an RFC's "Compatibility" section.

## Known gaps

None currently tracked. RFC-0002 closed the four baseline-model gaps
([ADR-0026](docs/adr/0026-prod-origin-in-the-gate.md),
[ADR-0027](docs/adr/0027-atomic-baseline-replacement.md)).
