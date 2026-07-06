# momus

Visual regression diffing for websites. momus captures full-page screenshots of
two deployments of the same site (typically a **dev** build and a **prod**
baseline), compares each page pixel-by-pixel, and produces a single
self-contained HTML report with side-by-side **dev | prod | diff** triptychs,
per-page diff scores, and a pass/fail gate — worst pages first.

Pages to compare are discovered automatically from the prod site (via
`sitemap.xml` and/or same-origin crawling), captured across one or more
viewport widths, stabilized (animations disabled, dynamic regions masked),
diffed in a worker pool, and gated against a configurable score threshold.

## Install

momus is distributed as a **Docker image** with the Chromium browser and all its
system libraries baked in — that's how you run it. (Running from source with Bun
is also supported for development.)

### With Docker (recommended — Chromium included)

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

### From source (development)

```bash
bun install            # install dependencies
bun run src/cli.ts install-browser   # download the Chromium momus drives
bun run src/cli.ts run               # capture, diff, and write the report
```

Use `bun run src/cli.ts <command>` (or the `bun momus` script) anywhere this
README shows the `momus` command. From source, `momus install-browser` downloads
Chromium in-process (a no-op if already present).

## Quick start

```bash
# scaffold momus.config.ts into the current directory
docker run --rm -v "$PWD:/work" bjhale/momus init
# edit momus.config.ts: point `dev` and `prod` at your two deployments
docker run --rm -v "$PWD:/work" bjhale/momus run --config momus.config.ts
```

Open the generated `momus-report.html` in any browser — it is fully
self-contained (images are embedded), so it can be committed as a CI artifact or
emailed as-is. No `install-browser` step is needed: Chromium is in the image.

To capture prod once and compare several dev builds against it:

```bash
# snapshot prod into momus.sqlite (do this once, or nightly in CI)
docker run --rm -v "$PWD:/work" bjhale/momus snapshot --config momus.config.ts
# diff any dev build against the frozen baseline (repeat as often as you like)
docker run --rm -v "$PWD:/work" bjhale/momus run --dev https://dev-pr-123.example.com
```

## Commands

### `momus init`

Writes a starter `momus.config.ts` in the current directory. Fails if one
already exists.

### `momus install-browser`

Downloads the Chromium build momus captures with.

### `momus snapshot [flags]`

Captures the **prod** baseline once into `output.db` (default `momus.sqlite`):
discovers pages from prod, screenshots each at every viewport, and stores the
prod images plus the capture context (viewports + stabilize settings). Reuse it
across many `momus run` invocations without re-screenshotting prod.
Running `momus snapshot` again replaces the baseline — it is how you refresh the
frozen prod capture that `momus run` reuses.

| Flag | Description |
| --- | --- |
| `--config FILE` | Path to the config file (default `./momus.config.ts`). |
| `--prod URL` | Override the config's `prod` base URL. |
| `--concurrency N` | Override the number of concurrent screenshots. |
| `--max-pages N` | Override the max pages to compare (`discovery.maxPages`; `0` = unlimited). |
| `--crawl` | Force same-origin crawl discovery on. |
| `--insecure` | Ignore invalid/self-signed TLS certs for discovery fetches and page loads (`insecure`). |

The baseline lives in its own tables inside `output.db`; the single SQLite file
is the portable artifact — commit it or pass it as a CI artifact.

### `momus run [flags]`

Runs the pipeline against the configured `dev` build, always diffing dev against
a stored **prod baseline**:

- **No baseline yet** (fresh `output.db`): `momus run` captures the prod baseline
  as its first step — discovering pages and screenshotting prod — then diffs dev
  against it and writes the report, all in one invocation.
- **Baseline present**: `momus run` reuses it and captures **dev only** — prod is
  **not** re-screenshotted (it is frozen). The run **fails fast (exit 2)** if the
  live config's `viewports` or `stabilize` settings differ from the baseline's.

Because prod is frozen after the first run, repeated `momus run` invocations diff
against the same prod baseline. To re-capture prod, run `momus snapshot` (which
replaces the baseline). Only the `runs`/`comparisons` tables are refreshed each
run; the baseline is preserved.

| Flag | Description |
| --- | --- |
| `--config FILE` | Path to the config file (default `./momus.config.ts`). |
| `--dev URL` | Override the config's `dev` base URL. |
| `--prod URL` | Override the config's `prod` base URL. |
| `--out FILE` | Override the report output path (default `momus-report.html`). |
| `--concurrency N` | Override the number of concurrent screenshots. |
| `--max-pages N` | Override the max pages to compare (`discovery.maxPages`; `0` = unlimited). |
| `--crawl` | Force same-origin crawl discovery on. |
| `--insecure` | Ignore invalid/self-signed TLS certs for discovery fetches and page loads (`insecure`). |

CLI flags win over config-file values.

On completion `momus run` prints, for example:

```
Wrote momus-report.html (12 comparisons). Exit 0.
```

## Configuration

`momus init` scaffolds a fully-typed `momus.config.ts`. The scaffold imports
`defineConfig` from `momus` for editor types, but a plain object works too — the
config is validated with Zod either way, and every field has a sensible default.

```ts
import { defineConfig } from "momus";

export default defineConfig({
  dev: "https://dev.example.com",   // the build under test
  prod: "https://www.example.com",  // the baseline; also the discovery source
  insecure: false,                  // set true to ignore invalid/self-signed TLS certs (dev only)

  discovery: {
    // urlList: "urls.txt",                                  // optional: newline-delimited full URLs or paths
    sitemap: true,                                            // read /sitemap.xml
    maxPages: 500,                                            // cap total pages (0 = unlimited)
    crawl: false,                                             // false | true | { startPath, maxDepth }
    include: ["/**"],                                         // path globs to keep
    exclude: ["/admin/**"],                                   // path globs to drop
  },

  viewports: [375, 768, 1280],                                // widths in px

  stabilize: {
    waitUntil: "networkidle",   // navigation wait strategy
    settleMs: 500,              // extra settle delay after load
    timeoutMs: 15000,           // per-page capture budget
    disableAnimations: true,    // freeze CSS animations/transitions
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],  // hide dynamic regions
    remove: [".cookie-banner"],                           // delete elements (space collapses)
  },

  diff: {
    threshold: 0.1,   // per-pixel color sensitivity (pixelmatch)
    failScore: 0.01,  // fraction of changed pixels that fails a page
    overrides: [{ path: "/blog/**", failScore: 0.05 }],  // per-path gates
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite" },
});
```

Notes:

- **Discovery** runs against `prod` (the baseline is the source of truth for
  which pages exist). Pages come from an optional `urlList` file and/or the
  `sitemap`, unioned together. **`urlList`** is a newline-delimited file of full
  URLs or bare paths (blank lines ignored); a full URL must be under the `prod`
  base URL (it is reduced to its path — the dev URL is the same path on the `dev`
  base), otherwise the run fails. **Crawling is opt-in** — set `crawl: true` (or a
  `crawl: { … }` object); when enabled it **seeds from the urlList∪sitemap union**
  (or `crawl.startPath` when those are empty) and expands via same-origin links.
  `maxPages` caps the total pages compared — the first N that survive
  `include`/`exclude`, in discovery order — across every source (`0` = no cap).
  Override per run with `--max-pages N`. `dev` and `prod` are treated as
  origins — a path prefix on the base URL is not preserved when joining
  discovered paths.
- **`failScore`** is the fraction of a page's pixels that may differ before the
  page fails. A page passes when its diff score is `<= failScore`. `overrides`
  apply a different gate to matching path globs.
- **`mask`** selectors are hidden before capture (via `visibility: hidden`, so
  they keep their layout space) — for inherently dynamic regions (carousels, ads,
  timestamps) that shouldn't produce false diffs. **`remove`** selectors are
  instead deleted from the DOM before capture, so the page reflows and their space
  collapses — for elements like cookie banners or chat widgets that shift layout.
  Use narrow selectors: an overly broad `remove` (e.g. `*` or `body`) deletes the
  whole page and yields a blank screenshot.
- **`insecure`** disables TLS certificate validation for both the discovery
  fetches and the browser page loads — for self-signed dev/staging servers. It
  removes MITM protection, so it defaults to `false` and should stay off against
  anything reachable by others; prefer a properly-issued cert or a trusted CA.

## Exit codes

`momus run` returns a process exit code so it can gate CI:

| Code | Meaning |
| --- | --- |
| `0` | All pages captured and passed the diff gate. |
| `1` | At least one page failed the gate **or** errored (e.g. a page failed to load or diff). A report is still written. |
| `2` | Operational error that prevented the run (missing browser, bad config, unrecoverable failure). |

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
5. **Report** — write a self-contained `momus-report.html`: a summary header
   (pass/fail verdict, counts, worst page, viewports) with an All/Passed/Failed
   filter, and each comparison as a collapsible accordion (page, width, change %,
   pass/fail) that expands to the `dev | prod | diff` screenshots — worst pages
   first. Then exit with the code above.

While capturing and diffing, momus renders a progress bar to **stderr** — one
phase for prod capture (on a fresh baseline) and one for dev capture + diff. In a
non-TTY environment (CI, piped output) it prints a plain progress line
periodically instead of redrawing. stdout carries only the final summary, so
piping stdout to a file stays clean.

## Releasing

Releases are cut by pushing a version tag. The
[`release` workflow](.github/workflows/release.yml) runs the test suite (with a
real Chromium so the integration/e2e tests execute), then in parallel:

- **GitHub release** — creates a release for the tag with auto-generated notes
  (a changelog; no binary assets — momus ships as the Docker image).
- **Docker image** — builds the image on native `amd64` and `arm64` runners and
  pushes a multi-arch tag to Docker Hub (`:<version>` and `:latest`).

```bash
git tag v0.1.0
git push origin v0.1.0   # triggers the release workflow
```

The tag name becomes the release name and image version.

**Required repository secrets** (Settings → Secrets and variables → Actions) for
the Docker publish:

| Secret | Value |
| --- | --- |
| `DOCKERHUB_USERNAME` | Your Docker Hub username (also the image namespace). |
| `DOCKERHUB_TOKEN` | A Docker Hub [access token](https://hub.docker.com/settings/security) with write scope. |

The base image tag in the [`Dockerfile`](Dockerfile) tracks the `playwright`
version in `bun.lock` (currently `1.61.1`) — bump both together on upgrade.

## Notes & known limitations

- **Distributed as a Docker image, not a standalone binary.** momus drives
  Chromium via Playwright, which needs its `node_modules` and a matching browser
  at runtime — awkward to ship as a lone executable. The image bundles momus
  (Bun + Playwright) and Chromium together, so there's nothing else to install,
  and diffs run in the full worker-thread pool (`concurrency.diffWorkers`).
- **Dimension mismatches are detected but not yet annotated.** When a page's dev
  and prod screenshots differ in height/width, the shorter image is padded with
  an opaque sentinel color so the size change reliably shows up as a diff (and
  raises the score). The report does not yet print an explicit "dimensions
  differed" note, nor does it store the original per-side dimensions — a planned
  enhancement.
- **A one-sided load failure records the error but not the good side's image.**
  If dev renders but prod 404s (or vice versa), the comparison is stored as an
  error with the message; the successfully-captured side is not currently shown
  on the error card.
- **One baseline per DB.** `momus snapshot` stores a single prod baseline in
  `output.db`; a new snapshot replaces it (and clears stale run results). Full
  multi-run history remains out of scope; a separate server component may add it
  later.
