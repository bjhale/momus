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
| `momus snapshot` | Discover from prod + capture prod → baseline tables. Replaces any existing baseline atomically; refuses (exit 2) if every capture failed. |
| `momus run` | Diff live dev against the stored prod baseline → report + exit code. Materializes a baseline first if none exists, or if `--snapshot` is passed. |
| `momus report` | Re-render a stored run's report: the latest, or `--run ID`. |

## The baseline model

`run` has exactly one path: **diff live dev against a stored prod baseline.**

- No baseline in the DB → `run` materializes one in the same invocation
  (discover + capture prod → `snapshot` + `baseline_images`), then diffs.
- Baseline present → it is **frozen**. `run` captures dev only and never touches
  prod. Refresh with `momus snapshot`, or `momus run --snapshot` to do the
  re-capture and the diff in one invocation.

Replacing a baseline is one transaction: if every prod capture fails, it rolls
back, the previous baseline (if any) survives, and the command exits 2
([ADR-0027](adr/0027-atomic-baseline-replacement.md)). Each run records the
baseline it used (`baseline_id` plus its identity JSON), so a later snapshot
doesn't invalidate stored runs.

A run's jobs come from `reconcile()` ([reconcile.ts](../src/targets/reconcile.ts))
over the baseline and each source's live list. A live target with no baseline
row is `added`, a baseline row its source no longer lists is `removed`, and both
fail the gate unless allowed ([ADR-0022](adr/0022-added-and-removed-targets.md)).
For pages the live list is the baseline's paths plus new `urlList` entries, so
no prod access is needed. A target whose recipe differs from its stored one is
an error row for that target alone
([ADR-0023](adr/0023-per-target-recipe-gate.md)).

Because the baseline is frozen, prod and dev are captured in separate phases
rather than near-simultaneously. That temporal skew is inherent to a frozen
baseline; selector masking is the mitigation.

Before diffing, a **compatibility gate** ([compat.ts](../src/pipeline/compat.ts))
compares the live config's prod origin, `browser`, `viewports`, `stabilize`,
prod `setup`, and the rendering environment (`pinned` in the Docker image,
`host` elsewhere; [ADR-0033](adr/0033-rendering-environment-in-the-gate.md))
against the baseline's. Any mismatch is a hard error (exit 2) — a dev capture at
1280px against a prod capture at 768px is ~100% "changed" and tells you nothing,
and a baseline from another prod origin is another site
([ADR-0026](adr/0026-prod-origin-in-the-gate.md)). `--prod` overrides
`config.prod`, so a mismatching `--prod` on `run` is caught the same way. Only
prod's setup is compared, as redacted canonical JSON in `snapshot.setup_json`
([ADR-0030](adr/0030-setup-per-side.md)); scenario recipes are gated per target.
A `stabilize` setting the baseline predates reads as the behavior it was
captured with, which for `reducedMotion` and `waitForImages` isn't today's
default, so such a baseline is refused until re-captured
([ADR-0032](adr/0032-determinism-defaults-and-old-baselines.md)).

`stabilize.verify` captures each baseline image twice; one that changed is
stored with its `unstable_regions_json`. A comparison against it whose change
regions all touch those regions is `unstable`: diffed and shown, never
counted. A change elsewhere is gated as usual. `retries` re-captures dev for a
compared target that fails the gate; prod is frozen, so a baseline error is
never retried ([ADR-0034](adr/0034-unstable-and-retries.md)).

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
├── commands/           # init, install, snapshot, run, report — config load, browser
│                       #   lifecycle, and wiring; logic lives in pipeline/
│   └── capture-seams.ts  # the real setupDev/setupProd/getDev/captureProd; holds the sessions
├── config/
│   ├── schema.ts       # Zod schema, ResolvedConfig, defineConfig()
│   ├── redact.ts       # redactConfig / setupIdentity: no credential, or hash of one, is stored
│   └── load.ts         # read config file, apply CLI overrides
├── targets/
│   ├── target.ts       # Target, TargetSource, ids, viewport narrowing, canonical recipe JSON (pure)
│   ├── pages.ts        # pagesSource: discovery for snapshots; baseline ∪ urlList for runs
│   ├── scenarios.ts    # scenariosSource: configured scenarios → targets with recipes
│   └── reconcile.ts    # baseline + live lists → jobs: compare / added / removed / error (pure)
├── discovery/
│   ├── urllist.ts      # parseUrlList: lines → paths (pure)
│   ├── sitemap.ts      # fetch/parse sitemap.xml + index recursion
│   ├── crawler.ts      # same-host BFS from N seed paths, depth + cap bounded
│   ├── fetcher.ts      # makeFetcher: the one real HTTP fetcher (TLS, headers)
│   └── discover.ts     # orchestrates sources → filter → dedupe → cap → sort
├── capture/
│   ├── browser.ts      # engine map, launch (pinned flags), newContext (media), renderingMode
│   ├── stabilize.ts    # wait, disable animations, mask/remove selectors
│   ├── steps.ts        # runSteps: the step vocabulary → Playwright calls; StepError
│   ├── setup.ts        # runSetup: log in once per side → in-memory session; SetupError
│   └── screenshot.ts   # capture(url, viewport, opts, extras) → PNG buffer (page or element)
├── pipeline/
│   ├── queue.ts        # mapWithConcurrency
│   ├── snapshot.ts     # discover + capture prod → baseline tables
│   ├── run.ts          # listJobs/getDev/getProd seams → diff → gate → persist
│   ├── run-flow.ts     # ensure-baseline → diff (the `run` orchestrator)
│   ├── compat.ts       # baselineConflict: is this baseline diffable?
│   └── verdict.ts      # failScore override resolution, pass/fail, exit code
├── diff/
│   ├── normalize.ts    # pad to common dimensions
│   ├── diff.ts         # pixelmatch → diff PNG + score + per-side sizes; pad band drawn magenta
│   ├── regions.ts      # changeRegions: changed pixels → clustered boxes (pure)
│   ├── worker.ts       # Worker entry
│   └── pool.ts         # worker pool, dispatch/collect, crash-respawn
├── store/
│   ├── migrations.ts   # ordered, frozen schema steps; PRAGMA user_version; newer-DB refusal
│   └── db.ts           # open + typed read/write helpers, run pruning
├── report/
│   ├── summary.ts      # derive counts/verdict/worst from records
│   ├── template.ts     # renderReport(rows, meta) → HTML string (pure)
│   └── report.ts       # read DB → write file
├── glob.ts             # matchPath(path, pattern) — one predicate for all globs
├── version.ts          # MOMUS_VERSION from package.json, recorded on every run
└── types.ts            # Job, CaptureResult, ComparisonRecord, …
```

The seams are deliberate: `runPipeline` takes `listJobs` / `getDev` / `getProd`
as injected functions, `discoverPaths` takes injectable sitemap/crawl/file-read
functions, and `Progress` is an interface. That is what lets the bulk of the
suite run with no browser and no network.

## Data model

One SQLite file (`output.db`, default `momus.sqlite`) holds four tables. The
schema is versioned with `PRAGMA user_version` and brought up to date on open by
the ordered, frozen steps in
[migrations.ts](../src/store/migrations.ts); a DB from a newer momus is refused
through a read-only probe before anything writes to it
([ADR-0024](adr/0024-versioned-schema-migrations.md)). v1 is the v0.9.x schema,
v2 keys the image tables on `target_id`
([ADR-0021](adr/0021-targets-and-source-provenance.md)), v3 adds run history,
v4 prod setup identity, v5 RFC-0006's columns (per-side sizes, regions,
instability, retries, rendering).

| Table | Rows | Purpose |
| --- | --- | --- |
| `runs` | one per kept run (`output.keepRuns`, default 5) | AUTOINCREMENT ids. Timestamps, dev/prod base URLs, resolved config JSON, status; provenance: momus version, engine + version, config hash, baseline id + identity, allow flags, CI commit/branch/PR. |
| `comparisons` | one per `target × viewport` | `target_id`, `source`, `label`, dev/prod/diff PNG BLOBs, padded dimensions and each side's own (`dev_width`…`prod_height`), `diff_pixels`, `diff_score`, `fail_score` (the gate that applied), `passed`, `status` (`ok`/`error`/`added`/`removed`/`unstable`), `error`, `regions_json` (largest 100) + `region_count`, `unstable_regions_json`, `retries`. Unique on `(run_id, target_id, viewport)`. |
| `snapshot` | one; id never reused | The baseline's identity: `created_at`, `prod_base_url`, `viewports_json`, `stabilize_json`, `browser`, `setup_json` (prod's redacted setup; NULL = none), `rendering` (`pinned`/`host`; NULL = host), full `config_json` (credentials redacted). Drives the compatibility gate and report provenance. |
| `baseline_images` | one per `target × viewport` | `target_id`, `source`, `label`, `recipe_json` (canonical, sorted keys; NULL = no recipe), frozen prod PNG BLOBs plus `status`/`error`, `unstable_regions_json` (NULL = stable or unverified). Unique on `(target_id, viewport)`. |

`run` inserts a run, then prunes to the newest `output.keepRuns` (0 = keep all)
and runs `incremental_vacuum`. Each run owns its images outright — no
content-hash dedupe — so pruning is a plain delete. `snapshot` replaces the
baseline tables and keeps runs: each holds its own prod images
([ADR-0025](adr/0025-run-history.md)).

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
| `stabilize` | `waitUntil`, `settleMs`, `timeoutMs`, `disableAnimations`, `mask`, `remove`, `waitForImages`, `clock`, `reducedMotion`, `colorScheme`. Gated against the baseline. `verify` too, but it isn't gated: it changes no pixels. |
| `retries` | Dev re-captures for a target that fails the gate (0–10, default 0). Not gated. |
| `diff` | `threshold` (per-pixel sensitivity) and `failScore` (page-level gate) — two different knobs, see [ADR-0004](adr/0004-two-threshold-knobs.md). Plus per-path `overrides`, and `includeAA` (default false: anti-aliasing detection on). |
| `concurrency` | `screenshots` (the `--concurrency` flag maps here) and `diffWorkers` (config only). |
| `scenarios` | Targets with `steps` and an optional `capture.element` / `viewports`. Gated per target ([ADR-0029](adr/0029-scenarios-and-step-order.md)). |
| `setup` | One login per side: shared or `{ dev, prod }`, each `steps` or `storageState`. Prod's is gated, redacted ([ADR-0030](adr/0030-setup-per-side.md)). |
| `output` | `report` path, `db` path, `keepRuns` (default 5; 0 = unlimited). One DB per site is the intended shape. |

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
  smaller image with an opaque magenta sentinel to the pair's max width×height.
  Never scale; scaling corrupts the comparison. The padded region legitimately
  reads as a diff; it is drawn magenta in the diff image, the report names the
  difference ("dev is 40 px taller than prod"), and each side's own size is
  stored ([ADR-0035](adr/0035-change-regions-and-the-pad-band.md)).
- **One side fails to capture**: the row is `error`, and it keeps the image of
  the side that rendered, so the report can show it.
- **`networkidle` never settles**: capped by `stabilize.timeoutMs`, then capture
  anyway.
- **Browser missing**: checked up front, names the engine, points at
  `momus install-browser`. Never auto-downloads mid-run.
- **Nothing discovered**: hard error — no sitemap, no urlList, and crawl off
  yields "no pages discovered".
- **Worker crash**: pool marks that comparison errored and respawns.
- **A step fails** (or `capture.element` matches nothing): that target's row is
  `error`, naming the step. The run goes on ([ADR-0029](adr/0029-scenarios-and-step-order.md)).
- **Setup fails**: no session means every capture would be a login screen, so it
  is operational, not per-target: exit 2, naming the side and step
  ([ADR-0030](adr/0030-setup-per-side.md)).
- **Source fails to list during a run**: one error row (`source:<name>`); that
  source's targets are skipped and the run continues.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran; nothing fails the gate: every comparison passed or is `unstable`, and any added/removed targets were allowed. |
| `1` | Ran; at least one comparison failed the gate, errored, or is `added`/`removed` (unless allowed). An error counts as a regression signal, not a silent pass. |
| `2` | Operational failure that prevented the run: no browser, bad config (including an unknown `MOMUS_RENDERING`), discovery threw, baseline conflict, DB from a newer momus, every prod capture failed, setup failed. |

`momus snapshot` exits `0` even when individual prod pages fail (they become
error rows) and `2` on operational failure, including every capture failing.
`momus report` exits `0`, or `2` for a missing DB file, no runs, or an unknown
run id.

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
- **Multi-engine tests** (steps, scenarios) loop over `TEST_ENGINES`: every
  engine, in the one test process, each skipped where it can't launch;
  `MOMUS_ENGINE` narrows to one. That needs Bun 1.4.3 or later: 1.3.14
  double-closed child-process descriptors, which broke browsers mid-test
  ([ADR-0036](adr/0036-bun-1-4-3-one-test-process.md)).
- **Integration** serves two tiny static sites from fixtures via `Bun.serve` and
  runs the real pipeline headless against them.

The report's interactive filter is verified manually; the unit tests assert the
buttons, `data-filter` attributes, status classes, and inline script are wired.

## Packaging

`bun build --compile` produces a single binary, but the **Docker image runs from
source** (`bun` + `node_modules`): Playwright resolves `playwright-core` from
`node_modules` at runtime and cannot be fully bundled into a standalone binary.
Source mode is also exactly what the test suite exercises. The base image tag
must track the `playwright` version in `bun.lock` — bump both together. The
image sets `MOMUS_RENDERING=pinned`, which makes it the reference rendering
environment ([ADR-0033](adr/0033-rendering-environment-in-the-gate.md)).
