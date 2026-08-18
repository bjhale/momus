# Contributing to momus

## Getting set up

momus runs on [Bun](https://bun.sh). Working from source needs the browser
engines installed locally, since you are not going through the Docker image that
bakes them in:

```bash
bun install                          # install dependencies
bun run src/cli.ts install-browser   # download Chromium, Firefox, WebKit
bun run src/cli.ts run               # capture, diff, and write the report
```

Use `bun run src/cli.ts <command>` — or the `bun momus` script — anywhere the
[README](README.md) shows the `momus` command. From source,
`install-browser` downloads the engines in-process and is a no-op if they are
already present.

To build the image locally:

```bash
bun run build:dev    # docker build -t momus-dev .
```

## Tests

```bash
bun test             # the whole suite
bunx tsc --noEmit    # typecheck
```

Most of the suite runs with **no browser and no network** — that is deliberate,
and it is what the injected seams throughout the codebase exist for. When adding
a feature, prefer testing behind a seam over reaching for a real browser:

- `runPipeline` takes `listJobs` / `getDev` / `getProd` as injected functions.
- `discoverPaths` takes injectable sitemap, crawl, and file-read functions.
- `makeFetcher` takes an injectable `fetch`.
- `Progress` is a three-method interface, not the `cli-progress` object.

Tests that genuinely need a real page are guarded with
`isBrowserInstalled() ? test : test.skip`, so they skip rather than fail on a
machine without engines installed. The end-to-end tests serve two small static
sites from `tests/fixtures/` via `Bun.serve` and run the real pipeline headless
against them.

See the testing section of [docs/architecture.md](docs/architecture.md) for how
the layers divide up.

## Where things live

[docs/architecture.md](docs/architecture.md) is the map: pipeline, module
responsibilities, the four-table SQLite schema, config resolution, error handling
and exit codes.

Two conventions worth knowing before you edit:

- **One bad page never aborts a run.** Per-page failures become rows with
  `status='error'`, not thrown exceptions. Exit `2` is reserved for operational
  failures that prevented the run entirely.
- **Anything that changes captured pixels belongs in the baseline compatibility
  gate** (`src/pipeline/compat.ts`), and needs a backward-compatible default so
  baselines captured before your change stay diffable.

## Design decisions

Decisions that would be expensive to reverse, or surprising to rediscover, are
recorded as ADRs in [docs/adr/](docs/adr/). If you are making a call that a
future reader would otherwise have to reverse-engineer from the code — a
trade-off, a rejected alternative, a deliberate constraint — add a record.

Records are **immutable once accepted**. When a decision changes, add a new
record that amends or supersedes the old one and link them both ways rather than
editing history. [ADR-0020](docs/adr/0020-run-snapshot-flag.md) amending
[ADR-0011](docs/adr/0011-run-always-diffs-a-baseline.md) is the worked example.

Number the file sequentially, follow the existing context → decision →
consequences shape, and add a row to the table in
[docs/adr/README.md](docs/adr/README.md).

## Releasing

Releases are cut by pushing a version tag. The
[`release` workflow](.github/workflows/release.yml) runs the test suite (with a
real Chromium, so the integration and e2e tests execute), then in parallel:

- **GitHub release** — creates a release for the tag with auto-generated notes
  (a changelog; no binary assets — momus ships as the Docker image).
- **Docker image** — builds on native `amd64` and `arm64` runners and pushes a
  multi-arch tag to Docker Hub (`:<version>` and `:latest`).

```bash
git tag v0.1.0
git push origin v0.1.0   # triggers the release workflow
```

The tag name becomes the release name and the image version.

**Required repository secrets** (Settings → Secrets and variables → Actions) for
the Docker publish:

| Secret | Value |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub username (also the image namespace). |
| `DOCKERHUB_TOKEN` | Docker Hub [access token](https://hub.docker.com/settings/security) with write scope. |

The base image tag in the [`Dockerfile`](Dockerfile) tracks the `playwright`
version in `bun.lock` (currently `1.61.1`) — **bump both together** on upgrade,
or the baked-in browsers stop matching the driver.
