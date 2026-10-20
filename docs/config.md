# Configuration reference

`momus init` scaffolds a typed `momus.config.ts`. The scaffold imports
`defineConfig` from `momus` for editor types, but a plain object works too, as
does a `.js` or `.json` file passed with `--config`. The config is validated
with Zod either way, and every field but `dev` and `prod` has a default.

**Unknown keys are an error.** A typo fails with exit 2 and, when a known key is
close, a suggestion, one line per key:

```text
Config error: stabilize.maks: unknown key; did you mean "mask"?
```

Command-line flags override the matching fields ([cli.md](cli.md)).

```ts
import { defineConfig } from "momus";

export default defineConfig({
  dev: "https://dev.example.com",   // the build under test
  prod: "https://www.example.com",  // the baseline; also the discovery source
  insecure: false,                  // set true to ignore invalid/self-signed TLS certs (dev only)
  browser: "chromium",              // engine: "chromium" | "firefox" | "webkit"

  discovery: {
    // urlList: "urls.txt",          // optional: newline-delimited full URLs or paths
    sitemap: true,                    // read /sitemap.xml
    maxPages: 500,                    // cap total pages (0 = unlimited)
    crawl: false,                     // false | true | { startPath, maxDepth }
    include: ["/**"],                 // path globs to keep
    exclude: ["/admin/**"],           // path globs to drop
  },

  viewports: [375, 768, 1280],        // widths in px

  stabilize: {
    waitUntil: "networkidle",   // navigation wait strategy
    settleMs: 500,              // extra settle delay after load
    timeoutMs: 15000,           // per-page capture budget
    disableAnimations: true,    // freeze CSS animations/transitions
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],  // hide dynamic regions
    remove: [".cookie-banner"],                           // delete elements (space collapses)
    waitForImages: true,        // wait for every <img> to load and decode
    // clock: "2026-01-01T00:00:00Z",  // pin Date, so relative times render the same
    reducedMotion: "reduce",    // emulate prefers-reduced-motion
    colorScheme: "light",       // emulate prefers-color-scheme: "light" | "dark" | "no-preference"
    verify: false,              // capture each baseline image twice; mark the ones that differ unstable
  },
  retries: 0,                   // re-capture dev up to N times before failing a target (0-10)

  diff: {
    threshold: 0.1,   // per-pixel color sensitivity (pixelmatch)
    includeAA: false, // count anti-aliased pixels as changes (false = AA detection on)
    failScore: 0.01,  // fraction of changed pixels that fails a page
    overrides: [{ path: "/blog/**", failScore: 0.05 }],  // per-path gates
    allowAdded: false,    // new-since-baseline targets fail unless true
    allowRemoved: false,  // baseline targets no longer listed fail unless true
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite", keepRuns: 5, reportImages: "embed" },

  // Pages in a particular state, and logging in. See "Scenarios" and "Setup".
  scenarios: [{ id: "nav-open", path: "/", steps: [{ click: "button[aria-label=Menu]" }] }],
  setup: { storageState: "auth.json" },
});
```

**Gated** fields below are recorded with the prod baseline. A `momus run` whose
value differs from the baseline's fails fast (exit 2) and says to re-capture,
because screenshots taken differently aren't comparable
([ADR-0010](adr/0010-baseline-compatibility-gate.md)).

## Sites

| Field | Default | Description |
| --- | --- | --- |
| `dev` | required | Base URL of the build under test. `--dev`. |
| `prod` | required | Base URL of the baseline, and the discovery source. Its origin is gated. `--prod`. |
| `insecure` | `false` | Disable TLS certificate validation for discovery fetches and page loads. `--insecure`. |
| `requestHeaders` | `{}` | Headers sent on every request, discovery and page loads alike. |
| `browser` | `"chromium"` | Engine for every capture: `"chromium"`, `"firefox"` or `"webkit"`. Gated, and so is the engine's exact version. `--browser`. |

`dev` and `prod` are treated as origins: a path prefix on the base URL is not
preserved when joining discovered paths.

**`insecure`** removes MITM protection, so it defaults to `false` and should
stay off against anything reachable by others; prefer a properly issued cert or
a trusted CA.

**`browser`** is recorded in the prod baseline with the engine's own version
string. A run with a different engine, or the same engine at another version
(after a Playwright or Docker image upgrade), is refused: a browser upgrade
changes rendering. Re-capture with `momus snapshot` (or `momus run --snapshot`).
A baseline captured before momus recorded the version is not compared until it
is next captured ([ADR-0038](adr/0038-engine-version-in-the-gate.md)).

**`requestHeaders`** reach sites behind an auth proxy. For example, to get
through **Cloudflare Access** with a service token, read the credentials from
the environment so no secrets live in the config file:

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
});
```

Pass the values into the container at runtime with `-e`, so they stay out of the
image and the config file:

```bash
docker run --rm -v "$PWD:/work" -e CF_ACCESS_CLIENT_ID -e CF_ACCESS_CLIENT_SECRET \
  bjhale/momus run --config momus.config.ts
```

`requestHeaders` values are stored in the `.sqlite` as-is.

## Discovery

| Field | Default | Description |
| --- | --- | --- |
| `discovery` | `{}` | Which prod pages to compare. |
| `discovery.urlList` | unset | A newline-delimited file of full URLs or bare paths. |
| `discovery.sitemap` | `true` | Read `/sitemap.xml` from prod. |
| `discovery.maxPages` | `500` | Cap on pages compared, after `include`/`exclude` (`0` = no cap). `--max-pages`. |
| `discovery.crawl` | `false` | Follow same-origin links: `false`, `true`, or an object. `--crawl`. |
| `discovery.crawl.enabled` | `true` in an object | Turn the crawl on or off; an object alone means on. |
| `discovery.crawl.startPath` | `"/"` | Where the crawl starts when `urlList` and the sitemap give nothing. |
| `discovery.crawl.maxDepth` | `3` | Link depth to follow. |
| `discovery.include` | `["/**"]` | Path globs to keep. |
| `discovery.exclude` | `[]` | Path globs to drop. |

Discovery runs against `prod`: the baseline is the source of truth for which
pages exist. Pages come from `urlList` and the sitemap, unioned. A full URL in
`urlList` must be under the `prod` base URL (it is reduced to its path, and the
dev URL is the same path on the `dev` base), otherwise the run fails; blank lines
are ignored. **Crawling is opt-in**; when enabled it seeds from the
urlList ∪ sitemap pages (or `startPath` when those are empty) and expands via
same-origin links. `maxPages` keeps the first N pages that survive
`include`/`exclude`, in discovery order, across every source.

On a `run` against a frozen baseline, `urlList` is re-read, and entries the
baseline lacks are captured on dev and reported **added** (they fail the gate
unless `diff.allowAdded`). `maxPages` caps the `urlList` itself, in file order,
so entries beyond the cap are not reported. Sitemap and crawl pages come only
from the baseline, so a page that is new on dev isn't seen until the next
`momus snapshot` unless it's listed in `urlList`. Removing a line from `urlList`
doesn't drop its baseline page.

Discovery doesn't use the `setup` session. For pages behind a login, list them
in `urlList` (or serve a public sitemap).

## Viewports

| Field | Default | Description |
| --- | --- | --- |
| `viewports` | `[375, 768, 1280]` | Widths in px; every page is captured at each. Gated. |

## Stabilize

Everything that makes a capture repeatable. Every field except `verify` changes
pixels, so all of them are gated.

| Field | Default | Description |
| --- | --- | --- |
| `stabilize` | `{}` | Capture settings. |
| `stabilize.waitUntil` | `"networkidle"` | Navigation wait: `"load"`, `"domcontentloaded"` or `"networkidle"`. |
| `stabilize.settleMs` | `500` | Extra delay after load. |
| `stabilize.timeoutMs` | `15000` | Per-page capture budget, steps included. |
| `stabilize.disableAnimations` | `true` | Freeze CSS animations and transitions. |
| `stabilize.mask` | `[]` | Selectors hidden before capture; they keep their layout space. |
| `stabilize.remove` | `[]` | Selectors deleted from the DOM before capture; the page reflows. |
| `stabilize.waitForImages` | `true` | Wait for web fonts and every rendered `<img>` to load and decode. |
| `stabilize.clock` | unset | Pin `Date` to this ISO instant. |
| `stabilize.reducedMotion` | `"reduce"` | Emulate `prefers-reduced-motion`. |
| `stabilize.colorScheme` | `"light"` | Emulate `prefers-color-scheme`: `"light"`, `"dark"` or `"no-preference"`. |
| `stabilize.verify` | `false` | Capture each baseline image twice and mark targets whose changes are only where prod itself moved as unstable. Not gated. |

**`mask`** is for inherently dynamic regions (carousels, ads, timestamps): they
are hidden with `visibility: hidden`, so the layout doesn't move. **`remove`**
is for elements that shift layout (cookie banners, chat widgets): they are
deleted, so their space collapses. Use narrow selectors: an overly broad
`remove` (`*`, `body`) deletes the whole page and yields a blank screenshot.

**Repeatable captures.** `waitForImages` skips images hidden with
`display:none` and is bounded by `timeoutMs`. `clock` makes "posted 3 minutes
ago" render the same every time; it is off by default because it can break apps
that poll. **A baseline captured by a momus older than these settings is
refused by a default config** (exit 2, naming the setting): it was captured
without reduced motion or the image wait. Re-capture it, or set
`reducedMotion: "no-preference"` and `waitForImages: false` to keep diffing
against it.

**`verify`** stores the regions where two captures of the same prod page
differed, and outlines them (dashed) in the report. A comparison whose changes
all fall in those regions is **unstable**: shown, but it doesn't fail the gate,
and `run` names the count on its last line. A change anywhere else is gated as
usual. Mask the moving regions and re-capture. It doubles the cost of a
snapshot, so it is off by default.

### Pinned rendering

The Docker image is the reference rendering environment: it sets
`MOMUS_RENDERING=pinned`, which launches Chromium with GPU compositing, font
hinting, subpixel text positioning and LCD text off and a fixed sRGB color
profile. A baseline records whether it was captured `pinned` or on the `host`,
and a run in the other environment is refused (exit 2). Outside the image,
`MOMUS_RENDERING` is unset (`host`); any value other than `pinned` or `host` is
a config error.

## Retries

| Field | Default | Description |
| --- | --- | --- |
| `retries` | `0` | Re-capture dev up to N times (0–10) for a target that failed the gate or errored. Not gated. |

A target fails only if every attempt fails. The report shows how many retries a
target needed, so flakiness stays visible. A prod error from the baseline is
never retried: the baseline is frozen.

## Diff

| Field | Default | Description |
| --- | --- | --- |
| `diff` | `{}` | The comparison and the gate. |
| `diff.threshold` | `0.1` | Per-pixel color sensitivity (pixelmatch), 0–1. |
| `diff.includeAA` | `false` | Count anti-aliased pixels as changes (`false` = anti-aliasing detection on). |
| `diff.failScore` | `0.01` | Fraction of a page's pixels that may differ before it fails. A page passes when its score is `<= failScore`. |
| `diff.overrides` | `[]` | Per-path gates, first match wins. |
| `diff.overrides[].path` | required | Path glob. Matches a scenario's `path` too. |
| `diff.overrides[].failScore` | required | The gate for matching paths. |
| `diff.allowAdded` | `false` | Don't fail for targets new since the baseline. `--allow-added`. |
| `diff.allowRemoved` | `false` | Don't fail for baseline targets no longer listed. `--allow-removed`. |

`threshold` and `failScore` are different knobs: the first decides whether a
pixel changed, the second how many changed pixels fail a page
([ADR-0004](adr/0004-two-threshold-knobs.md)).

## Concurrency

| Field | Default | Description |
| --- | --- | --- |
| `concurrency` | `{}` | Parallelism. |
| `concurrency.screenshots` | `6` | Concurrent captures. `--concurrency`. |
| `concurrency.diffWorkers` | `4` | Diff worker threads. |

## Output

| Field | Default | Description |
| --- | --- | --- |
| `output` | `{}` | Where results go. |
| `output.report` | `"momus-report.html"` | Report path. `--out`. |
| `output.db` | `"momus.sqlite"` | The database: baseline plus run history. One per site. |
| `output.keepRuns` | `5` | Runs kept in `output.db` (`0` = all). |
| `output.reportImages` | `"embed"` | `"embed"`, `"link"` or `"thumbnails"`. `--report-images`. |

**`keepRuns`**: each run stores its own dev, prod and diff images, so the file
grows with this number; the oldest runs are pruned and their space reclaimed
after every run. Lower it if you commit the file.

**`reportImages`**: `embed` inlines every image, one file you can send anywhere
but heavy for a large site. `link` writes the PNGs to `<report name>-images/`
beside the report. `thumbnails` inlines small WebP previews and links the
originals, which the 1:1 view loads. With `link` or `thumbnails`, keep the
directory with the report. Previews are for display only; diffs always use the
full captures.

## Scenarios

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

| Field | Default | Description |
| --- | --- | --- |
| `scenarios` | `[]` | Extra targets, each a page in a state. |
| `scenarios[].id` | required | Unique, no whitespace. The target id is `scenarios:<id>`. |
| `scenarios[].path` | required | The page, starting with `/`. |
| `scenarios[].steps` | `[]` | Steps to run after load (table below). |
| `scenarios[].capture` | full page | What to screenshot. |
| `scenarios[].capture.element` | unset | Screenshot the first element matching this selector instead of the page. |
| `scenarios[].viewports` | all | A subset of the top-level `viewports`. |

Steps run in order after the page has loaded and settled, and before `mask` and
`remove` are applied. Selectors use Playwright locator syntax (`text=`, `role=`
work) and act on the **first** match. Each step is an object with exactly one
key:

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

- If `capture.element` matches nothing, the target is an error row; it never
  falls back to the full page. `mask` and `remove` still apply.
- A width in `scenarios[].viewports` that isn't in the top-level list is a
  config error.
- A step that fails, or times out after `stabilize.timeoutMs`, is an error row
  for that scenario, naming the step number (from 1) and selector. The run goes on.
- Scenarios ignore `discovery.include`, `exclude` and `maxPages`.
- `diff.overrides` match a scenario's `path`, so a `"/"` override also applies
  to every scenario at `"/"`.
- A scenario's steps and capture are recorded with its baseline image and gated
  per target: change them and that target errors until re-captured.
- **Don't put credentials in scenario steps.** `goto` is not allowed there, and
  `fill` and `select` values, `evaluate` scripts, and selectors are stored in
  the `.sqlite` as-is.

## Setup

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

`goto` (setup only) is relative to each side's base URL, so one set of steps
logs in to both. A shared `storageState` loads one file into both sides; cookies
are domain-scoped, so when dev and prod are on different hosts use a per-side
`storageState` instead. Dev and prod often need different logins, so `setup`
can also be one per side:

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

| Field | Default | Description |
| --- | --- | --- |
| `setup` | unset | One login shared by both sides, or one per side. |
| `setup.steps` | | Shared login steps (the scenario steps plus `goto`). |
| `setup.storageState` | | Shared Playwright session file. |
| `setup.dev` | | Dev's own setup; requires `setup.prod`. |
| `setup.dev.steps` | | Dev's login steps. |
| `setup.dev.storageState` | | Dev's session file. |
| `setup.prod` | | Prod's own setup; requires `setup.dev`. |
| `setup.prod.steps` | | Prod's login steps. |
| `setup.prod.storageState` | | Prod's session file. |

Different users can render different personalized content, such as a name in the
header. That shows up as a diff. Use `mask` for it.

- Each side is `steps` or `storageState`, chosen independently. A `storageState`
  file must be JSON with `cookies` and `origins` arrays.
- Shared and per-side keys can't be mixed, and a per-side `setup` must define
  both sides.
- Setup runs at the widest configured viewport, so a login form hidden behind a
  mobile menu is still reachable.
- Prod logs in only when momus captures a baseline. A `run` against a frozen
  baseline never touches prod.
- **A setup failure exits 2**, naming the side and step, for example
  `setup (prod) step 3: fill "#password"`. Without a session every page would
  capture the login screen.
- **Where credentials may live.** Put them only in a setup `fill` value or a
  `storageState` file. Setup `fill` values and `storageState` paths are redacted
  before anything is stored, and the session is kept in memory only. Everything
  else is stored in the `.sqlite` as-is: `goto` URLs, `evaluate` scripts,
  `select` values, and every scenario step.
- Prod's setup is gated; dev's isn't. Because `fill` values are redacted,
  rotating a password doesn't invalidate the baseline, and switching prod to a
  different user isn't caught: re-run `momus snapshot` when you do.
