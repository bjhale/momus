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
emailed as-is. No `install-browser` step is needed: the browser engines are in the image.

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

Downloads the browser engines momus captures with (Chromium, Firefox, WebKit).

### `momus snapshot [flags]`

Captures the **prod** baseline once into `output.db` (default `momus.sqlite`):
discovers pages from prod, screenshots each at every viewport, and stores the
prod images plus the capture context (viewports + stabilize settings). Reuse it
across many `momus run` invocations without re-screenshotting prod.
Running `momus snapshot` again replaces the baseline — it is how you refresh the
frozen prod capture that `momus run` reuses. The replacement is all-or-nothing:
if **every** prod capture fails (prod unreachable), nothing is saved, the
previous baseline is kept, and the command exits 2. If only some pages fail, the
baseline is saved with those pages as error rows. Stored runs are kept; each
holds its own copy of the prod images it was diffed against.

| Flag | Description |
| --- | --- |
| `--config FILE` | Path to the config file (default `./momus.config.ts`). |
| `--prod URL` | Override the config's `prod` base URL. |
| `--concurrency N` | Override the number of concurrent screenshots. |
| `--max-pages N` | Override the max pages to compare (`discovery.maxPages`; `0` = unlimited). |
| `--crawl` | Force same-origin crawl discovery on. |
| `--insecure` | Ignore invalid/self-signed TLS certs for discovery fetches and page loads (`insecure`). |
| `--browser NAME` | Engine to capture with (`chromium`\|`firefox`\|`webkit`); overrides `browser`. |

The baseline lives in its own tables inside `output.db`; the single SQLite file
is the portable artifact — commit it or pass it as a CI artifact.

### `momus run [flags]`

Runs the pipeline against the configured `dev` build, always diffing dev against
a stored **prod baseline**:

- **No baseline yet** (fresh `output.db`): `momus run` captures the prod baseline
  as its first step — discovering pages and screenshotting prod — then diffs dev
  against it and writes the report, all in one invocation.
- **Baseline present**: `momus run` reuses it and captures **dev only** — prod is
  **not** re-screenshotted (it is frozen) and prod's `setup` login doesn't run. The run **fails fast (exit 2)** if the
  live config's `browser`, `viewports`, `stabilize` or prod `setup` differ from the
  baseline's.
- **Different prod origin**: if `prod` (or `--prod`) has a different origin
  (scheme, host, port) than the baseline was captured from, the run fails with
  exit 2 and names both. Re-capture with `momus run --snapshot` (or
  `momus snapshot`), or point `output.db` at a separate file for the other site.

Because prod is frozen after the first run, repeated `momus run` invocations diff
against the same prod baseline. Each run is stored as a new run in `output.db`;
the newest `output.keepRuns` (default 5) are kept and older ones pruned. To
re-capture prod, run `momus snapshot` (which replaces the baseline), or pass
`momus run --snapshot` to do that re-capture and the diff in a single
invocation. A first run (or `--snapshot`) that can't capture a single prod page
exits 2 without saving a baseline.

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
| `--browser NAME` | Engine to capture with (`chromium`\|`firefox`\|`webkit`); overrides `browser`. |
| `--snapshot` | Re-capture the prod baseline before diffing, even when `output.db` already holds one (ignores the freeze). Equivalent to running `momus snapshot` first, in a single invocation. |
| `--allow-added` | Don't fail the run for targets that are new since the baseline (`diff.allowAdded`). They are still reported. |
| `--allow-removed` | Don't fail the run for baseline targets that are no longer listed (`diff.allowRemoved`). They are still reported. |
| `--commit SHA` | Record the commit this run tested. Stored on the run; no effect on the result. |
| `--branch NAME` | Record the branch this run tested. |
| `--pr N` | Record the pull request this run tested. |

CLI flags win over config-file values.

On completion `momus run` prints, for example:

```text
Wrote momus-report.html for run #7 (12 comparisons). Exit 0.
```

### `momus report [flags]`

Re-renders the HTML report for a run stored in `output.db` — the latest by
default. It needs no browser and no network, and never creates a DB file. The
pass/fail gate is the one recorded on that run, so an old run renders with the
verdict it had, whatever today's config says. A run that did not complete
(failed or interrupted) renders as FAIL with its status in the header, and the
command prints a warning. `report` loads the same config file (for `output.db`
and `output.report`), so the config must validate, dev and prod URLs included.

| Flag | Description |
| --- | --- |
| `--run ID` | Render this run instead of the latest. Run ids are never reused. |
| `--out FILE` | Override the report output path (default `momus-report.html`). |
| `--config FILE` | Path to the config file (default `./momus.config.ts`); used for `output.db` and `output.report`. |

Exits `0` on success and `2` if there is no DB file, no runs, or no run with that
id (the message lists the ids available).

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
  browser: "chromium",              // engine: "chromium" | "firefox" | "webkit"

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
    allowAdded: false,    // new-since-baseline targets fail unless true
    allowRemoved: false,  // baseline targets no longer listed fail unless true
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite", keepRuns: 5 },  // keepRuns: 0 = keep all

  // Pages in a particular state, and logging in. See "Scenarios" and "Setup" below.
  scenarios: [{ id: "nav-open", path: "/", steps: [{ click: "button[aria-label=Menu]" }] }],
  setup: { storageState: "auth.json" },
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

  On a `run` against a frozen baseline, `urlList` is re-read, and entries the
  baseline lacks are captured on dev and reported **added** (they fail the gate
  unless `--allow-added`). `maxPages` caps the `urlList` itself, in file order, so
  entries beyond the cap are not reported. Sitemap and crawl pages come
  only from the baseline, so a page that is new on dev isn't seen until the next
  `momus snapshot` unless it's listed in `urlList`. Removing a line from `urlList`
  doesn't drop its baseline page.
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
- **`browser`** selects the Playwright engine used for every capture:
  `"chromium"` (default), `"firefox"`, or `"webkit"`. Override per run with
  `--browser NAME`. The engine is recorded in the prod baseline; a `momus run`
  whose `browser` differs from the baseline's fails fast (exit 2), because
  screenshots from different engines are not comparable. Re-capture with
  `momus snapshot` to change the baseline's engine.
- **`output.keepRuns`** is how many runs `output.db` keeps (default `5`; `0` =
  unlimited). Each run stores its own dev, prod and diff images, so the file
  grows with this number; the oldest runs are pruned and their space reclaimed
  after every run. Lower it if you commit the file.
- **`requestHeaders`** is an optional map of headers sent on every request — both
  the discovery fetches and the browser page loads — to reach sites behind an
  auth proxy. For example, to get through **Cloudflare Access** with a service
  token, pull the credentials from the environment so no secrets live in the
  config file:

  ```ts
  export default defineConfig({
    dev: "https://dev.example.com",
    prod: "https://www.example.com",

    requestHeaders: {
      ...(Bun.env.CF_ACCESS_CLIENT_ID && {
        "CF-Access-Client-Id": Bun.env.CF_ACCESS_CLIENT_ID,
      }),
      ...(Bun.env.CF_ACCESS_CLIENT_SECRET && {
        "CF-Access-Client-Secret": Bun.env.CF_ACCESS_CLIENT_SECRET,
      }),
    },

    // …rest of config
  });
  ```

  Because the config reads the tokens from `Bun.env`, pass them into the
  container at runtime with `-e` (Docker forwards the values from your host
  shell, so the secrets stay out of the image and the config file):

  ```bash
  docker run --rm -v "$PWD:/work" \
    -e CF_ACCESS_CLIENT_ID \
    -e CF_ACCESS_CLIENT_SECRET \
    bjhale/momus run --config momus.config.ts
  ```

### Scenarios

Pages render one state on load. A **scenario** puts a page in another state
(menu open, form with errors) and screenshots it, on dev and prod alike:

```ts
scenarios: [
  {
    id: "nav-open",
    path: "/",
    steps: [
      { click: "button[aria-label=Menu]" },
      { waitFor: "nav[data-open]" },
    ],
    capture: { element: "nav" },   // optional; default is the full page
    viewports: [375],              // optional; narrows the top-level viewports
  },
  {
    id: "signup-errors",
    path: "/signup",
    steps: [{ click: "button[type=submit]" }, { waitFor: ".field-error" }],
  },
],
```

Each scenario is a target with id `scenarios:<id>`. Steps run in order after the
page has loaded and settled, and before `mask` and `remove` are applied.
Selectors use Playwright locator syntax (`text=`, `role=` work) and act on the
**first** match.

| Step | Argument | Does |
| --- | --- | --- |
| `click` | selector | Clicks the element. |
| `hover` | selector | Hovers it. |
| `fill` | `[selector, value]` | Types the value into the field. |
| `press` | key, or `[selector, key]` | Presses a key on the page, or on that element. |
| `select` | `[selector, value]` | Chooses the `<option>` with that value. |
| `scroll` | selector | Scrolls the element into view. |
| `waitFor` | selector, or `{ hidden: selector }` | Waits until it is visible (or hidden). |
| `wait` | ms | Waits a fixed time. Discouraged; prefer `waitFor`. |
| `evaluate` | string | Runs the JavaScript in the page. The escape hatch. |

- **`capture.element`** screenshots the first matching element instead of the
  page. If nothing matches, the target is an error row; it never falls back to
  the full page. `mask` and `remove` still apply.
- **`viewports`** narrows a scenario to some of the top-level `viewports`. A
  width not in the top-level list is a config error.
- A step that fails, or times out after `stabilize.timeoutMs`, is an error row
  for that scenario, naming the step number (from 1) and selector. The run goes on.
- Scenarios ignore `discovery.include`, `exclude` and `maxPages`.
- `diff.overrides` match a scenario's `path`, so a `"/"` override also applies
  to every scenario at `"/"`.
- **Don't put credentials in scenario steps.** `goto` is not allowed there, and
  `fill` and `select` values, `evaluate` scripts, and selectors are stored in
  the `.sqlite` as-is.

### Setup

Most real apps sit behind a login. `setup` logs in once per side, before any
capture, and every capture on that side reuses the session:

```ts
setup: {
  steps: [
    { goto: "/login" },
    { fill: ["#email", Bun.env.MOMUS_USER!] },
    { fill: ["#password", Bun.env.MOMUS_PASS!] },
    { click: "button[type=submit]" },
    { waitFor: "[data-user-menu]" },
  ],
  // or: storageState: "auth.json"   // a Playwright login session file
},
```

`goto` is relative to each side's base URL, so one set of steps logs in to both.
A shared `storageState` loads one file into both sides; cookies are
domain-scoped, so when dev and prod are on different hosts use a per-side
`storageState` instead.
Dev and prod often need different logins, so `setup` can also be one per side:

```ts
setup: {
  dev: {
    steps: [
      { goto: "/login" },
      { fill: ["#email", Bun.env.MOMUS_DEV_USER!] },
      { fill: ["#password", Bun.env.MOMUS_DEV_PASS!] },
      { click: "button[type=submit]" },
      { waitFor: "[data-user-menu]" },
    ],
  },
  prod: { storageState: "prod-auth.json" },
},
```

Different users can render different personalized content, such as a name in the
header. That shows up as a diff. Use `mask` for it.

- Each side is `steps` or `storageState`, chosen independently. A `storageState`
  file must be JSON with `cookies` and `origins` arrays.
- Shared and per-side keys can't be mixed, and a per-side `setup` must define
  both sides.
- Setup runs at the widest configured viewport, so a login form hidden behind a
  mobile menu is still reachable.
- Discovery (sitemap, crawl) doesn't use the setup session. For pages behind
  the login, list them in `urlList` (or serve a public sitemap).
- Prod logs in only when momus captures a baseline. A `run` against a frozen
  baseline never touches prod.
- **A setup failure exits 2**, naming the side and step, for example
  `setup (prod) step 3: fill "#password"`. Without a session every page would
  capture the login screen.
- **Where credentials may live.** Put them only in a setup `fill` value or a
  `storageState` file. Setup `fill` values and `storageState` paths are redacted
  before anything is stored, and the session is kept in memory only. Everything
  else is stored in the `.sqlite` as-is: `goto` URLs, `evaluate` scripts,
  `select` values, and every scenario step. (`requestHeaders` values are also
  stored; that predates setup.)
- Prod's setup is part of the baseline compatibility check; dev's isn't. Because
  `fill` values are redacted, rotating a password doesn't invalidate the
  baseline, and switching prod to a different user isn't caught: re-run
  `momus snapshot` when you do.

## Exit codes

`momus run` returns a process exit code so it can gate CI (`snapshot` and
`report` use `0` and `2` the same way):

| Code | Meaning |
| --- | --- |
| `0` | All pages captured and passed the diff gate. |
| `1` | At least one page failed the gate, errored, or is **added**/**removed** (unless allowed). A report is still written. |
| `2` | Operational error that prevented the run: missing browser, bad config, a baseline conflict (different prod origin, browser, viewports, stabilize or prod setup), a DB written by a newer momus, every prod capture failing, a failed `setup` login, or another unrecoverable failure. |

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
  `output.db`; a new snapshot replaces it. The last `output.keepRuns` runs are
  kept alongside it, and `momus report --run ID` re-renders any of them.
