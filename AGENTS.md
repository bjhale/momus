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
bun test                             # whole suite (~190 tests, ~8s)
bunx tsc --noEmit                    # typecheck
bun run src/cli.ts <command>         # run momus from source (or: bun momus)
bun run src/cli.ts install-browser   # needed once before browser-guarded tests
bun run build:dev                    # docker build -t momus-dev .
```

Run **both** `bun test` and `bunx tsc --noEmit` before claiming work is done.
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
- **CLI flags beat config-file values beat defaults.** Flags are registered
  globally in `parseArgs`, so a flag only one command reads is still accepted by
  the others.

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

## Known gaps

Real, unresolved, and easy to trip over:

- **The compatibility gate ignores `prod_base_url`.** A DB pointed at a second
  site diffs against the first site's baseline and produces a clean-looking
  report full of garbage. `--prod` on `run` is likewise a silent no-op when a
  baseline exists. ([ADR-0020](docs/adr/0020-run-snapshot-flag.md))
- **An all-error materialize still freezes.** A first `run` while prod is
  unreachable freezes a baseline of error rows, reused until `momus snapshot`
  runs again. ([ADR-0011](docs/adr/0011-run-always-diffs-a-baseline.md))
- `momus snapshot --snapshot` parses and does nothing.
