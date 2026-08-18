# momus — Architecture

How momus is built and why the pieces sit where they do. For usage, see the
[README](../README.md). For the reasoning behind specific choices, see the
[decision records](adr/).

## What it is

A CLI that screenshots two deployments of the same site (dev and prod), diffs
them page by page at several viewport widths, and writes a self-contained HTML
report sorted worst-first. Bun + TypeScript, Playwright for capture, SQLite
(`bun:sqlite`) for storage, `pixelmatch` for diffing.

Three properties drive the design: parallelize the I/O-bound capture and the
CPU-bound diff separately; keep false positives low by stabilizing pages before
capture; emit one file a human can open.

## Commands

| Command | Does |
| --- | --- |
| `momus init` | Scaffold a commented `momus.config.ts`. |
| `momus install-browser` | Download all three Playwright engines. The **only** command that downloads a browser. |
| `momus snapshot` | Discover from prod + capture prod → baseline tables. Replaces any existing baseline. |
| `momus run` | Diff live dev against the stored prod baseline → report + exit code. Materializes a baseline first if none exists, or if `--snapshot` is passed. |

## The baseline model

`run` has exactly one path: **diff live dev against a stored prod baseline.**

- No baseline in the DB → `run` materializes one in the same invocation
  (discover + capture prod → `snapshot` + `baseline_images`), then diffs.
- Baseline present → it is **frozen**. `run` captures dev only and never touches
  prod. Refresh with `momus snapshot`, or `momus run --snapshot` to do the
  re-capture and the diff in one invocation.

Because the baseline is frozen, prod and dev are captured in separate phases
rather than near-simultaneously. That temporal skew is inherent to a frozen
baseline; selector masking is the mitigation.

Before diffing, a **compatibility gate** ([compat.ts](../src/pipeline/compat.ts))
compares the live config's `browser`, `viewports`, and `stabilize` against the
baseline's. Any mismatch is a hard error (exit 2) — a dev capture at 1280px
against a prod capture at 768px is ~100% "changed" and tells you nothing.

## Pipeline

```text
  ┌── momus snapshot ──────────────────────┐   ┌── momus run ──────────────────┐
  │ discovery (urlList ∪ sitemap, then     │   │ jobs = baseline_images rows   │
  │ optional seeded crawl) → filter →      │   │                               │
  │ dedupe → maxPages cap → sort           │   │  ┌─────────────────────────┐  │
  │            │                           │   │  │ capture dev (pool of N) │  │
  │            ▼  path × viewport          │   │  └───────────┬─────────────┘  │
  │  ┌──────────────────────┐              │   │              ▼ pair           │
  │  │ capture prod (pool N)│              │   │  ┌─────────────────────────┐  │
  │  └──────────┬───────────┘              │   │  │ diff pool (K Workers)   │  │
  │             ▼                          │   │  │ pixelmatch → PNG + score│  │
  │      baseline_images ──────────────────┼───┼─▶└───────────┬─────────────┘  │
  └────────────────────────────────────────┘   │              ▼ gate + persist │
                                               │      runs / comparisons       │
                                               │              ▼                │
                                               │   self-contained HTML report  │
                                               └───────────────────────────────┘
```

`runFlow` ([run-flow.ts](../src/pipeline/run-flow.ts)) orchestrates the right
side and, when materializing, invokes the left side first. The commands are thin
wiring over it.

### Concurrency

- **Capture is I/O-bound** — Chromium renders in its own processes; momus just
  awaits. Saturated with N concurrent Playwright pages via `mapWithConcurrency`,
  not OS threads.
- **Diffing is CPU-bound** — `pixelmatch` inline would block Bun's event loop and
  stall capture, so it runs in a pool of K Worker threads.
- **All SQLite writes happen on the main thread** (WAL mode, single-writer
  model). Workers return buffers by message; the main thread persists.
- Pairs are diffed and flushed as they complete, so memory stays bounded rather
  than holding every PNG at once.

### Progress

Both pipelines take an optional `Progress` ([progress.ts](../src/progress.ts)) —
a three-method seam (`start`/`tick`/`stop`) over `cli-progress`, rendered to
**stderr** so piped stdout stays clean. Phases are sequential: `snapshot` shows
one bar, a reused-baseline `run` shows one, a materializing `run` shows two.
Discovery is not barred (its total is unknowable mid-crawl). Tests inject a fake
recorder; the pipelines never see the library.

## Module map

```text
src/
├── cli.ts              # arg parsing (util.parseArgs), subcommand dispatch, help
├── commands/           # init, install, snapshot, run — config load, browser
│                       #   lifecycle, and wiring; logic lives in pipeline/
├── config/
│   ├── schema.ts       # Zod schema, ResolvedConfig, defineConfig()
│   └── load.ts         # read config file, apply CLI overrides
├── discovery/
│   ├── urllist.ts      # parseUrlList: lines → paths (pure)
│   ├── sitemap.ts      # fetch/parse sitemap.xml + index recursion
│   ├── crawler.ts      # same-host BFS from N seed paths, depth + cap bounded
│   ├── fetcher.ts      # makeFetcher: the one real HTTP fetcher (TLS, headers)
│   └── discover.ts     # orchestrates sources → filter → dedupe → cap → sort
├── capture/
│   ├── browser.ts      # engine map, launch, newContext
│   ├── stabilize.ts    # wait, disable animations, mask/remove selectors
│   └── screenshot.ts   # capture(url, viewport, opts) → PNG buffer
├── pipeline/
│   ├── queue.ts        # mapWithConcurrency
│   ├── snapshot.ts     # discover + capture prod → baseline tables
│   ├── run.ts          # listJobs/getDev/getProd seams → diff → gate → persist
│   ├── run-flow.ts     # ensure-baseline → diff (the `run` orchestrator)
│   ├── compat.ts       # baselineConflict: is this baseline diffable?
│   └── verdict.ts      # failScore override resolution, pass/fail, exit code
├── diff/
│   ├── normalize.ts    # pad to common dimensions
│   ├── diff.ts         # pixelmatch → diff PNG + score
│   ├── worker.ts       # Worker entry
│   └── pool.ts         # worker pool, dispatch/collect, crash-respawn
├── store/db.ts         # open/migrate + typed read/write helpers
├── report/
│   ├── summary.ts      # derive counts/verdict/worst from records
│   ├── template.ts     # renderReport(rows, meta) → HTML string (pure)
│   └── report.ts       # read DB → write file
├── glob.ts             # matchPath(path, pattern) — one predicate for all globs
└── types.ts            # Job, CaptureResult, ComparisonRecord, …
```

The seams are deliberate: `runPipeline` takes `listJobs` / `getDev` / `getProd`
as injected functions, `discoverPaths` takes injectable sitemap/crawl/file-read
functions, and `Progress` is an interface. That is what lets the bulk of the
suite run with no browser and no network.

## Data model

One SQLite file (`output.db`, default `momus.sqlite`) holds four tables. All are
created with `CREATE TABLE IF NOT EXISTS` on open, so an older DB gains new
tables automatically.

| Table | Rows | Purpose |
| --- | --- | --- |
| `runs` | one (`id = 1`) | Run metadata: timestamps, dev/prod base URLs, resolved config JSON, status. A table rather than a key/value blob so run history can be added later without a rewrite. |
| `comparisons` | one per `path × viewport` | dev/prod/diff PNG BLOBs, dimensions, `diff_pixels`, `diff_score`, `passed`, `status` (`ok`/`error`), `error`. Unique on `(run_id, path, viewport)`. |
| `snapshot` | one (`id = 1`) | The baseline's identity: `created_at`, `prod_base_url`, `viewports_json`, `stabilize_json`, `browser`, full `config_json`. Drives the compatibility gate and report provenance. |
| `baseline_images` | one per `path × viewport` | Frozen prod PNG BLOBs plus `status`/`error`. Unique on `(path, viewport)`. |

`run` truncates only `runs`/`comparisons`; the baseline tables survive.
`snapshot` clears the baseline **and** the stale run rows (a new baseline
invalidates prior results).

Images are BLOBs, not files — the single `.sqlite` is the portable artifact you
can commit or pass as a CI artifact.

## Configuration

`momus.config.ts` exports an object validated by Zod
([schema.ts](../src/config/schema.ts)). Precedence: **CLI flags → config file →
built-in defaults**.

| Field | Notes |
| --- | --- |
| `dev`, `prod` | Base URLs. Discovery always runs against `prod`. |
| `browser` | `chromium` (default) \| `firefox` \| `webkit`. Gated against the baseline. |
| `insecure` | Ignore invalid/self-signed TLS on **both** surfaces (discovery fetch and browser navigation). Off by default. |
| `requestHeaders` | Sent on discovery fetches and page loads (e.g. CF Access headers). |
| `discovery` | `urlList`, `sitemap`, `maxPages` (0 = unlimited), `crawl` (bool or object, off by default), `include`/`exclude` globs. |
| `viewports` | Widths; full-page height each. Gated against the baseline. |
| `stabilize` | `waitUntil`, `settleMs`, `timeoutMs`, `disableAnimations`, `mask`, `remove`. Gated against the baseline. |
| `diff` | `threshold` (per-pixel sensitivity) and `failScore` (page-level gate) — two different knobs, see [ADR-0004](adr/0004-two-threshold-knobs.md). Plus per-path `overrides`. |
| `concurrency` | `screenshots` (the `--concurrency` flag maps here) and `diffWorkers` (config only). |
| `output` | `report` path and `db` path. One DB per site is the intended shape. |

### Discovery order

```text
seeds  = urlList entries (if set) ++ sitemap entries (if enabled)
raw    = crawl enabled ? crawl(seeds or [startPath]) : seeds
kept   = raw.filter(include/exclude)
result = dedupe(kept)  →  slice(0, maxPages)  →  sort()      // throws if empty
```

The cap counts pages that survive filtering, and is applied in *discovery* order
before the alphabetical sort. The crawler shares the same `keep` predicate so it
stops fetching once enough surviving pages are found, while still traversing
*through* excluded pages to reach included ones.

## Error handling

The governing rule: **one bad page never aborts a run.** A capture failure, a
worker crash, an unreachable URL — each becomes a row with `status='error'` and a
message, surfaced in the report as an error card.

- **Dimension mismatch** (the common case — full-page heights differ): pad the
  smaller image with transparent pixels to the pair's max width×height. Never
  scale; scaling corrupts the comparison. The padded region legitimately reads as
  a diff.
- **`networkidle` never settles**: capped by `stabilize.timeoutMs`, then capture
  anyway.
- **Browser missing**: checked up front, names the engine, points at
  `momus install-browser`. Never auto-downloads mid-run.
- **Nothing discovered**: hard error — no sitemap, no urlList, and crawl off
  yields "no pages discovered".
- **Worker crash**: pool marks that comparison errored and respawns.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran; every comparison is `ok` and passed its gate. |
| `1` | Ran; at least one comparison failed the gate **or** errored. An error counts as a regression signal, not a silent pass. |
| `2` | Operational failure that prevented the run: no browser, bad config, discovery threw, baseline conflict. |

`momus snapshot` exits `0` even when individual prod pages fail (they become
error rows) and `2` only on operational failure.

## Testing

`bun:test`. Browser and network stay out of the great majority of tests by
testing behind the seams listed above.

- **Pure units** carry most of the coverage: sitemap/urlList parsing, crawler BFS
  against canned HTML, glob matching, config defaults and override precedence,
  diff scoring and padding against PNG fixtures, verdict/exit-code selection,
  `renderReport` output structure, store round-trips.
- **Pipeline tests** drive `runFlow`/`runPipeline`/`snapshotPipeline` with fake
  capture and discovery functions against an in-memory DB — real orchestration,
  no browser.
- **Browser-guarded tests** (`isBrowserInstalled() ? test : test.skip`) cover the
  handful of things that need a real page, like selector removal.
- **Integration** serves two tiny static sites from fixtures via `Bun.serve` and
  runs the real pipeline headless against them.

The report's interactive filter is verified manually; the unit tests assert the
buttons, `data-filter` attributes, status classes, and inline script are wired.

## Packaging

`bun build --compile` produces a single binary, but the **Docker image runs from
source** (`bun` + `node_modules`): Playwright resolves `playwright-core` from
`node_modules` at runtime and cannot be fully bundled into a standalone binary.
Source mode is also exactly what the test suite exercises. The base image tag
must track the `playwright` version in `bun.lock` — bump both together.
