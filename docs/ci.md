# Running momus in CI

momus is built to gate a pipeline: `momus run` exits `0` when every page passes,
`1` when something failed the gate, and `2` when it couldn't run at all
([cli.md](cli.md#exit-codes)). A CI job needs three things:

1. **The Docker image**, pinned to a version (`bjhale/momus:<version>`). The
   image fixes the browser build, and the baseline remembers which browser
   version captured it ([ADR-0038](adr/0038-engine-version-in-the-gate.md)), so
   a floating `:latest` can turn an unrelated upgrade into a failed job. Bump
   the tag deliberately, and re-capture the baseline when you do.
2. **The baseline database** (`output.db`, default `momus.sqlite`) carried from
   one job to the next. Without it, every `run` captures prod again first; that
   works, but it is slower and compares against today's prod rather than a
   frozen one.
3. **The report uploaded** whether the job passed or not.

## GitHub Actions

A nightly job captures the baseline and saves it to the Actions cache. Pull
requests restore the newest one and diff their preview deployment against it.

```yaml
# .github/workflows/momus-baseline.yml
name: momus baseline
on:
  schedule: [{ cron: "0 3 * * *" }]
  workflow_dispatch:

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker run --rm -v "$PWD:/work" bjhale/momus:0.9.4 snapshot
      # A new key every night; pull requests restore the newest by prefix.
      - uses: actions/cache/save@v4
        with:
          path: momus.sqlite
          key: momus-baseline-${{ github.run_id }}
```

```yaml
# .github/workflows/momus.yml
name: momus
on: pull_request

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/cache/restore@v4
        with:
          path: momus.sqlite
          key: momus-baseline-
          restore-keys: momus-baseline-
      # …deploy the preview, or wait for it…
      - run: >
          docker run --rm -v "$PWD:/work" bjhale/momus:0.9.4 run
          --dev "https://pr-${{ github.event.number }}.preview.example.com"
          --report-images thumbnails
          --commit "${{ github.sha }}" --branch "${{ github.head_ref }}" --pr "${{ github.event.number }}"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: momus-report
          path: |
            momus-report.html
            momus-report-images/
```

- Caches saved on the default branch are readable from pull requests, and
  unused caches expire after a week; the nightly job keeps one fresh.
- `--report-images thumbnails` keeps the artifact small; the report links the
  full images in `momus-report-images/`, so upload both
  ([config.md](config.md#output)).
- `--commit`, `--branch` and `--pr` are recorded on the run, for when you look
  at the DB later. They don't change the result.

### Keeping the baseline in the repository

For a small site, commit `momus.sqlite` instead and skip the cache. Set
`output.keepRuns` low (for example `1`): every run stores its own images, so the
file grows with it. Refresh the baseline by running `momus snapshot` locally (in
the same image) and committing the result.

## GitLab CI

Use the image as the job image, with its entrypoint cleared so the job's
`script` runs:

```yaml
momus:
  image:
    name: bjhale/momus:0.9.4
    entrypoint: [""]
  cache:
    key: momus-baseline
    paths: [momus.sqlite]
  script:
    - bun run /app/src/cli.ts run --dev "$PREVIEW_URL" --report-images thumbnails
      --commit "$CI_COMMIT_SHA" --branch "$CI_COMMIT_REF_NAME"
  artifacts:
    when: always
    paths: [momus-report.html, momus-report-images/]
```

The image sets `MOMUS_RENDERING=pinned`, so a baseline captured here only diffs
against captures made in the same image ([config.md](config.md#pinned-rendering)).
Capture the baseline in CI too, not on a laptop outside the image.

## Secrets

Read credentials from the environment in `momus.config.ts`, never write them in
it, and pass them to the container with `-e NAME` (GitHub: from `secrets.*`;
GitLab: from CI/CD variables). Only setup `fill` values and `storageState`
paths are redacted before anything is stored in `momus.sqlite`; see
[config.md](config.md#setup) for what else is stored as-is.

## When a job exits 2

Exit 2 means momus didn't compare anything. The message says why. The common
ones in CI:

- **Baseline conflict**: the baseline was captured differently (another prod
  origin, browser, browser version, viewports, stabilize settings, prod setup,
  or rendering environment). After a deliberate change, re-capture: run the
  baseline job, or `momus run --snapshot`.
- **Config error**: an unknown key or flag, or an invalid value. The message
  names the key and often the one you meant.
- **Every prod capture failed**: prod was unreachable from the runner.
