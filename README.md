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

## Requirements

- [Bun](https://bun.sh) 1.3+
- A Chromium browser (installed via `momus install-browser`)

## Install

### From a release binary (recommended)

Download the binary for your platform from the [latest release](../../releases/latest)
(`momus-linux-x64`, `momus-linux-arm64`, `momus-darwin-x64`, `momus-darwin-arm64`),
then:

```bash
chmod +x momus-linux-x64
mv momus-linux-x64 /usr/local/bin/momus   # or anywhere on your PATH
momus install-browser                     # download the Chromium momus drives
```

Verify the download against `SHA256SUMS` (published with each release):

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### From source

```bash
bun install          # install dependencies
momus install-browser  # download the Chromium build momus drives
```

`momus install-browser` fetches the Playwright-managed Chromium into the local
Playwright cache. Run it once per machine (or after upgrading). It is a no-op if
a compatible browser is already installed.

> Running from source? Use `bun run src/cli.ts <command>` (or the `bun momus`
> script) anywhere this README shows the `momus` command.

## Quick start

```bash
momus init                       # scaffold momus.config.ts
# edit momus.config.ts: point `dev` and `prod` at your two deployments
momus install-browser            # one-time browser download
momus run                        # capture, diff, and write momus-report.html
```

Open `momus-report.html` in any browser — it is fully self-contained (images
are embedded), so it can be committed as a CI artifact or emailed as-is.

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
real Chromium so the integration/e2e tests execute), then cross-compiles the
single-file binary for all four targets from one Linux runner and publishes a
GitHub release with the binaries and a `SHA256SUMS` file.

```bash
git tag v0.1.0
git push origin v0.1.0   # triggers the release workflow
```

The tag name becomes the release name. The Chromium browser is **not** bundled
in the binary (it's ~150 MB and platform-specific) — end users fetch it once
with `momus install-browser`.

## Notes & known limitations

- **Diffing in the compiled binary runs on the main thread.** Under `bun run`,
  diffs execute in a pool of worker threads (`concurrency.diffWorkers`). In the
  `bun build --compile` standalone binary, Bun cannot resolve the worker module
  out of the embedded filesystem, so `momus` transparently falls back to inline
  main-thread diffing. Results are identical; only diff parallelism is reduced.
  Screenshot capture (the dominant cost) is parallel in both modes. Restoring
  worker-based diffing in the compiled binary is a possible future improvement.
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
