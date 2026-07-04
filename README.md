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

Two ways to run momus: the **Docker image** (recommended — Chromium and all its
system libraries are baked in, nothing else to install) or a **standalone
binary** (smaller, but you supply a Chromium browser).

### With Docker (recommended — Chromium included)

Nothing to install but Docker. Mount your working directory (containing
`momus.config.ts`) at `/work`:

```bash
docker run --rm -v "$PWD:/work" YOUR_DOCKERHUB_USER/momus \
  run --config momus.config.ts
```

The report and SQLite DB are written into the mounted directory. The container
needs network access to your `dev`/`prod` URLs — if they run on your host, use
the appropriate Docker networking (e.g. `--network host` on Linux, or
`host.docker.internal` in the URLs on Docker Desktop).

### From a release binary (bring your own browser)

Download the binary for your platform from the [latest release](../../releases/latest)
(`momus-linux-x64`, `momus-linux-arm64`, `momus-darwin-x64`, `momus-darwin-arm64`,
or `momus-windows-x64.exe`) and verify it against `SHA256SUMS`:

```bash
sha256sum -c SHA256SUMS --ignore-missing
chmod +x momus-linux-x64
mv momus-linux-x64 /usr/local/bin/momus   # anywhere on your PATH
```

The binary is self-contained **except for the browser** (a full-size Chromium is
~150 MB and platform-specific, so it isn't bundled). Provide one either way:

```bash
# use Playwright's installer (needs Node/npm available once), or…
npx playwright install chromium
# …point momus at an existing Playwright browser cache:
export PLAYWRIGHT_BROWSERS_PATH=/path/to/ms-playwright
```

momus locates Chromium via `$PLAYWRIGHT_BROWSERS_PATH` or the default Playwright
cache. If it can't find one, `momus run` exits with guidance.

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

Using the Docker image (replace `YOUR_DOCKERHUB_USER/momus` with the published
image name):

```bash
# scaffold momus.config.ts into the current directory
docker run --rm -v "$PWD:/work" YOUR_DOCKERHUB_USER/momus init
# edit momus.config.ts: point `dev` and `prod` at your two deployments
docker run --rm -v "$PWD:/work" YOUR_DOCKERHUB_USER/momus run --config momus.config.ts
```

Open the generated `momus-report.html` in any browser — it is fully
self-contained (images are embedded), so it can be committed as a CI artifact or
emailed as-is. No `install-browser` step is needed: Chromium is in the image.

## Commands

### `momus init`

Writes a starter `momus.config.ts` in the current directory. Fails if one
already exists.

### `momus install-browser`

Downloads the Chromium build momus captures with.

### `momus run [flags]`

Runs the full pipeline: discover → capture → diff → report.

| Flag | Description |
| --- | --- |
| `--config FILE` | Path to the config file (default `./momus.config.ts`). |
| `--dev URL` | Override the config's `dev` base URL. |
| `--prod URL` | Override the config's `prod` base URL. |
| `--out FILE` | Override the report output path (default `momus-report.html`). |
| `--concurrency N` | Override the number of concurrent screenshots. |
| `--crawl` | Force same-origin crawl discovery on. |

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

  discovery: {
    sitemap: true,                                            // read /sitemap.xml
    crawl: { enabled: true, startPath: "/", maxDepth: 3, maxPages: 500 },
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
  which pages exist). If `sitemap` is enabled and returns pages, those are
  authoritative; crawling is used only as a fallback when the sitemap is empty.
  Provide a `sitemap.xml` or same-origin `<a href>` links so pages can be found.
- **`failScore`** is the fraction of a page's pixels that may differ before the
  page fails. A page passes when its diff score is `<= failScore`. `overrides`
  apply a different gate to matching path globs.
- **`mask`** selectors are hidden before capture so inherently dynamic regions
  (carousels, ads, timestamps) don't produce false diffs.

## Exit codes

`momus run` returns a process exit code so it can gate CI:

| Code | Meaning |
| --- | --- |
| `0` | All pages captured and passed the diff gate. |
| `1` | At least one page failed the gate **or** errored (e.g. a page failed to load or diff). A report is still written. |
| `2` | Operational error that prevented the run (missing browser, bad config, unrecoverable failure). |

## How it works

1. **Discover** — collect paths from the prod site's sitemap and/or crawl.
2. **Capture** — for each path × viewport, screenshot both dev and prod with
   animations disabled and masked regions hidden.
3. **Diff** — compare the two PNGs in a pool of worker threads (pixelmatch),
   producing a diff image and a diff score.
4. **Gate** — mark each page pass/fail against `failScore` (or a path override).
5. **Report** — write a self-contained `momus-report.html`, worst pages first,
   and exit with the code above.

## Releasing

Releases are cut by pushing a version tag. The
[`release` workflow](.github/workflows/release.yml) runs the test suite (with a
real Chromium so the integration/e2e tests execute), then in parallel:

- **Binaries** — cross-compiles the single-file binary for all five targets
  (linux x64/arm64, macOS x64/arm64, Windows x64) from one Linux runner and
  publishes a GitHub release with the binaries and a `SHA256SUMS` file.
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

- **The standalone binary needs a browser supplied separately.** The binary is
  self-contained (it drives Chromium via `playwright-core`, which bundles
  cleanly) but does not embed the ~150 MB Chromium itself — install it with
  `npx playwright install chromium` or point `$PLAYWRIGHT_BROWSERS_PATH` at an
  existing cache. The Docker image avoids this by baking Chromium in.
- **Diffing:** under `bun run` and the Docker image, diffs run in a worker-thread
  pool (`concurrency.diffWorkers`). In a `bun build --compile` binary, Bun can't
  resolve the worker module from the embedded filesystem, so momus transparently
  falls back to inline main-thread diffing — identical results, less diff
  parallelism (screenshot capture, the dominant cost, is parallel either way).
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
- **Run history is out of scope for now** (single-run, overwritten each run), by
  design; a separate server component may add history later.
