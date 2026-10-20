# momus

Visual regression diffing for websites. momus captures full-page screenshots of
two deployments of the same site (typically a **dev** build and a **prod**
baseline), compares each page pixel-by-pixel, and produces a single
self-contained HTML report for reviewing the differences: **dev | prod | diff**
side by side, a slider, onion skin, and change highlights, with keyboard triage,
per-page diff scores, and a pass/fail gate — worst pages first.

Pages to compare are discovered automatically from the prod site (via
`sitemap.xml` and/or same-origin crawling), captured across one or more
viewport widths, stabilized (animations disabled, dynamic regions masked),
diffed in a worker pool, and gated against a configurable score threshold.

Working on momus itself? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Install

momus is distributed as a **Docker image** with all three browser engines
(Chromium, Firefox, WebKit) and their system libraries baked in — that's how you
run it.

Nothing to install but Docker. Mount your working directory (containing
`momus.config.ts`) at `/work`:

```bash
docker run --rm -v "$PWD:/work" bjhale/momus \
  run --config momus.config.ts
```

The report and SQLite DB are written into the mounted directory. The container
needs network access to your `dev`/`prod` URLs — if they run on your host, use
the appropriate Docker networking (e.g. `--network host` on Linux, or
`host.docker.internal` in the URLs on Docker Desktop).

## Quick start

```bash
# scaffold momus.config.ts into the current directory
docker run --rm -v "$PWD:/work" bjhale/momus init
# edit momus.config.ts: point `dev` and `prod` at your two deployments
docker run --rm -v "$PWD:/work" bjhale/momus run --config momus.config.ts
```

Open the generated `momus-report.html` in any browser — it is fully
self-contained (images are embedded), so it can be committed as a CI artifact or
emailed as-is. For a large site, `--report-images thumbnails` keeps it small
(see [`output.reportImages`](docs/config.md#output)). No `install-browser` step
is needed: the browser engines are in the image.

To capture prod once and compare several dev builds against it:

```bash
# snapshot prod into momus.sqlite (do this once, or nightly in CI)
docker run --rm -v "$PWD:/work" bjhale/momus snapshot --config momus.config.ts
# diff any dev build against the frozen baseline (repeat as often as you like)
docker run --rm -v "$PWD:/work" bjhale/momus run --dev https://dev-pr-123.example.com
```

## Documentation

- [Commands and flags](docs/cli.md): `init`, `install-browser`, `snapshot`,
  `run`, `report`, and the exit codes.
- [Configuration](docs/config.md): every field, scenarios (pages in a
  particular state) and setup (logging in).
- [CI recipes](docs/ci.md): GitHub Actions and GitLab, keeping the baseline
  between jobs, uploading the report.
- [Stability](docs/stability.md): what 1.x promises, and the deprecation
  policy. Changes are in the [changelog](CHANGELOG.md).
- [Architecture](docs/architecture.md) and [decision records](docs/adr/), for
  how it works inside.

## How it works

1. **Discover** — collect paths from the prod site's sitemap and/or crawl.
   `momus run` captures this prod baseline itself on first use, then reuses it —
   discovery and prod capture run only when there is no baseline yet (or after
   `momus snapshot` refreshes it).
2. **Capture** — for each path × viewport, screenshot both dev and prod with
   animations disabled and masked regions hidden.
3. **Diff** — compare the two PNGs in a pool of worker threads (pixelmatch),
   producing a diff image and a diff score.
4. **Gate** — mark each page pass/fail against `failScore` (or a path override).
5. **Report** — write `momus-report.html`: a summary header (pass/fail
   verdict, counts, worst page, viewports) with filters by status, source,
   viewport and name, and each comparison as a collapsible accordion (page,
   width, change %, pass/fail) — worst pages first. An open comparison shows
   `dev | prod | diff` side by side, or a **slider** across dev and prod, an
   **onion skin** fading between them, or dev alone with its changes
   **highlighted**; **1:1** shows real pixels and drag pans. Keys: `j`/`k` next
   and previous, `1`–`4` or `m` mode, `z` 1:1, `g` group a target's viewports
   together, `/` search. The report needs JavaScript, all of it inline.
   Changed areas are clustered into regions ("3 regions") and outlined
   on all three images. A page whose dev and prod sizes differ says so ("dev is
   40 px taller than prod"), and the band only one side covers is drawn magenta
   in the diff. A capture that failed on one side still shows the side that
   rendered. Then exit `0`, `1` or `2` ([exit codes](docs/cli.md#exit-codes)).

## Notes & known limitations

- **The database is versioned and migrated in place.** Opening an `output.db`
  from an older momus upgrades it step by step; don't open it with the older
  version afterwards. A DB written by a **newer** momus is refused (exit 2) and
  left untouched — upgrade momus or point `output.db` elsewhere.
- **Distributed as a Docker image, not a standalone binary.** momus drives
  Chromium via Playwright, which needs its `node_modules` and a matching browser
  at runtime — awkward to ship as a lone executable. The image bundles momus
  (Bun + Playwright) and Chromium together, so there's nothing else to install,
  and diffs run in the full worker-thread pool (`concurrency.diffWorkers`).
- **One baseline per DB.** `momus snapshot` stores a single prod baseline in
  `output.db`; a new snapshot replaces it. The last `output.keepRuns` runs are
  kept alongside it, and `momus report --run ID` re-renders any of them.
