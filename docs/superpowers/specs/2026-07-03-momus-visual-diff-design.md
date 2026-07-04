# momus — Visual Regression Diff CLI — Design

**Date:** 2026-07-03
**Status:** Approved design, ready for implementation planning

## 1. Overview

`momus` is a command-line utility that captures and compares screenshots of two
deployments of the same website (typically a development site and a production
site), then produces a human-readable report of the visual differences between
them.

It is a **visual regression tool**: discover the pages, screenshot each page on
both sites at multiple viewport widths, compute a pixel diff and a difference
score per page, and render a self-contained HTML report sorted worst-first.

Built with **Bun + TypeScript** and compiled to a **single binary** via
`bun build --compile`. Screenshots are captured with a real headless browser
(Playwright/Chromium). An embedded **SQLite** database (`bun:sqlite`) stores
screenshots, diff images, and scores as BLOBs instead of using the filesystem.

### Goals

- Fast: parallelize the I/O-bound screenshotting and the CPU-bound diffing.
- Low false-positive rate: stabilize pages before capture (wait, disable
  animations, mask dynamic selectors).
- Self-contained output: one HTML report a human can open and review.
- Ship as one binary; browser is fetched separately and managed for the user.

### Non-goals (v1)

- No run history / trend analysis. **Single run, overwritten each time.** A
  separate server component may add history later; the schema is shaped to allow
  it without a rewrite.
- No baseline-approval workflow (compare live dev-vs-prod, not vs a stored,
  approved baseline).
- No per-pixel/box "ignore regions" in the diff step (selector masking only).

## 2. Requirements (decisions made during brainstorming)

| Area | Decision |
|------|----------|
| URL discovery | Sitemap-driven, with link-following crawl as a fallback when no sitemap exists or `--crawl` is set. |
| Page pairing | By URL path: the same path is requested on both base URLs. |
| Diff method | pixelmatch diff **image** plus a numeric difference **score**. |
| Capture | Full-page screenshots at multiple configurable viewport widths. |
| Browser | Playwright/Chromium, installed explicitly via `momus install-browser`. `momus run` never downloads mid-run: if the pinned Chromium is absent it prints guidance and exits non-zero (CI-friendly). |
| Storage | `bun:sqlite`, images as BLOBs, single-run DB overwritten each run. |
| Report | Self-contained HTML (images inlined as base64 data URIs). |
| Stability | Wait for network-idle + settle delay, disable animations, mask configured CSS selectors. |
| Config | `momus.config.{ts,json}` file with CLI flag overrides; `momus init` scaffolds it. |
| Concurrency | Async page pool for screenshots (I/O-bound) + Bun Worker-thread pool for diffing (CPU-bound). |

## 3. Architecture & Pipeline

`momus run` is a producer → consumer pipeline running on the main thread's event
loop, with a Worker-thread pool hanging off the diff stage.

```
                                          ┌─────────────────────────┐
  discovery (async)        job queue      │  screenshot pool (N)     │
  ┌────────────┐          ┌─────────┐     │  N concurrent Playwright │
  │ sitemap    │──paths──▶│ path ×  │────▶│  pages; each job shoots  │
  │ (+ crawl   │          │ viewport│     │  dev+prod → 2 PNG buffers │
  │  fallback) │          │  jobs   │     └───────────┬─────────────┘
  └────────────┘          └─────────┘                 │ pair (dev,prod)
                                                       ▼
                                          ┌─────────────────────────┐
                                          │  diff pool (K Workers)   │
                                          │  pixelmatch → diff PNG   │
                                          │  + score, off event loop │
                                          └───────────┬─────────────┘
                                                       ▼ results + blobs
                                          ┌─────────────────────────┐
   report ◀── read all rows ──────────────│  SQLite (bun:sqlite)     │
   (self-contained HTML)                  │  single writer, main thd │
                                          └─────────────────────────┘
```

### Stages

1. **Discovery** — fetch/parse `sitemap.xml` (recursing into sitemap index
   files); if absent or `--crawl`, follow same-domain links from a start URL up
   to a depth limit. Apply include/exclude globs. Emit a deduped set of paths.
   > **Discovery source is a single side (v1).** The sitemap is fetched from the
   > `prod` base URL (treated as the source of truth for the page set); the crawl
   > fallback likewise runs against one side. The same discovered paths are then
   > requested on **both** dev and prod. Consequence: a page that exists **only**
   > on dev (e.g. a brand-new unreleased page not yet in prod's sitemap) is not
   > discovered or compared in v1. This is intentional — momus reports drift on
   > the known page set. A prod page missing on dev is handled by the "page fails
   > to load on one side" path (§7).
2. **Job fan-out** — expand each path into one job per configured viewport width
   → `path × viewport` jobs onto a bounded queue.
3. **Screenshot pool** — a semaphore of size *N* drives *N* concurrent Playwright
   pages. Each job navigates dev and prod at that viewport, applies stabilization
   (network-idle wait, disable animations, mask selectors), and captures two
   full-page PNG buffers.
4. **Diff pool** — each captured pair is dispatched to a Bun Worker running
   `pixelmatch`, producing a diff PNG buffer + a difference score (fraction of
   changed pixels) + pass/fail vs the resolved threshold.
5. **Persist** — the main thread writes screenshots, diff image, score, and
   pass/fail into SQLite.
6. **Report** — after the pipeline drains, read all rows and emit a
   self-contained HTML report (images as base64 data URIs), pages sorted
   worst-first.

### Concurrency rationale

- **Screenshotting is I/O-bound**: Chromium renders in its own multi-process
  engine; Bun code just awaits. Saturated with async concurrency (N in-flight
  pages), not OS threads.
- **Pixel diffing is CPU-bound**: `pixelmatch` would block Bun's event loop and
  stall the screenshot pipeline if run inline, so it runs in a pool of *K* Bun
  Worker threads.
- **Backpressure**: the bounded job queue plus the screenshot/diff semaphores
  keep memory bounded — pairs are diffed and flushed to SQLite as they complete,
  rather than holding every PNG in RAM at once.
- SQLite is opened in WAL mode; **all writes happen on the main thread** (Workers
  return buffers via message; the main thread persists) to respect SQLite's
  single-writer model.

## 4. Modules & Project Structure

Each module has one responsibility, a clear interface, and is independently
testable. Browser and network access are isolated behind interfaces so the bulk
of logic can be unit-tested without either.

```
momus/
├── src/
│   ├── cli.ts                 # entry: arg parsing, subcommands, wires config → pipeline
│   ├── config/
│   │   ├── schema.ts          # Zod schema + TS types + defineConfig() helper
│   │   └── load.ts            # find/read/validate config, apply flag overrides, defaults
│   ├── discovery/
│   │   ├── sitemap.ts         # fetch + parse sitemap.xml / sitemap index → paths
│   │   ├── crawler.ts         # same-domain BFS link crawl to depth limit (fallback)
│   │   └── discover.ts        # orchestrates: sitemap first, crawl fallback, include/exclude, dedupe
│   ├── capture/
│   │   ├── browser.ts         # Playwright lifecycle: launch, context, teardown
│   │   ├── stabilize.ts       # network-idle wait, disable animations, mask selectors
│   │   └── screenshot.ts      # capture one (url, viewport) → PNG buffer (browser-agnostic interface)
│   ├── pipeline/
│   │   ├── queue.ts           # bounded async job queue + semaphore
│   │   └── run.ts             # orchestrates discovery → screenshot pool → diff pool → persist
│   ├── diff/
│   │   ├── worker.ts          # Bun Worker: 2 PNGs → normalize → pixelmatch → diff PNG + score
│   │   └── pool.ts            # Worker pool mgmt, dispatch/collect, crash-respawn
│   ├── store/
│   │   ├── schema.sql         # table DDL
│   │   └── db.ts              # bun:sqlite open/migrate + typed read/write helpers
│   ├── report/
│   │   ├── template.ts        # HTML generation (side-by-side dev | prod | diff)
│   │   └── report.ts          # read run from DB → write self-contained HTML
│   └── types.ts               # shared domain types (Job, CaptureResult, DiffResult, …)
├── tests/                     # bun:test unit + integration tests
├── momus.config.example.ts
├── package.json
├── tsconfig.json
└── build.ts (or package script)  # bun build --compile → single binary
```

### Tech stack

- **Runtime/build:** Bun + TypeScript; `bun build --compile` for the binary;
  `bun:test` for tests.
- **Browser:** Playwright/Chromium, installed explicitly via `momus
  install-browser` (never auto-downloaded during `momus run`; see §7).
- **Diffing:** `pixelmatch` + `pngjs` (decode PNG buffers to raw pixels).
- **DB:** `bun:sqlite` (built in).
- **Config validation:** `zod`.
- **CLI parsing:** Bun's `util.parseArgs` (kept minimal; a small subcommand lib
  may be adopted during implementation if help ergonomics warrant it).
- **Path globbing:** a small glob matcher for include/exclude/override paths
  (`picomatch` or a tiny inline matcher — decided during implementation).

### CLI surface

- `momus init` — scaffold a commented `momus.config.ts`.
- `momus run [--dev URL] [--prod URL] [--out report.html] [--crawl] [--concurrency N]`
  — run the full pipeline.
- `momus install-browser` — fetch the pinned Chromium. This is the **only**
  command that downloads a browser; `momus run` never does.

### `--concurrency` flag mapping

`--concurrency N` sets the **screenshot** pool size (`concurrency.screenshots`),
the primary throughput knob. It does **not** change `concurrency.diffWorkers`;
tune diff-worker count via the config file. If a user needs both, they set them
in config. (Rationale: the screenshot pool is the usual bottleneck and the one
users reach for on the command line.)

## 5. Data Model (SQLite)

Single-run DB, overwritten each run, but shaped so a future history/server
component can extend it without a rewrite (`runs` is a table, not a bare
key/value blob).

```sql
-- One row: metadata for the current run. Single-run for now, but a table
-- (not a bare key/value) so a future server can add rows per run.
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,        -- always 1 in single-run mode
  started_at    TEXT NOT NULL,              -- ISO8601
  finished_at   TEXT,
  dev_base_url  TEXT NOT NULL,
  prod_base_url TEXT NOT NULL,
  config_json   TEXT NOT NULL,              -- resolved config snapshot
  status        TEXT NOT NULL               -- 'running' | 'complete' | 'failed'
);

-- One row per (path × viewport) comparison.
CREATE TABLE comparisons (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  path          TEXT NOT NULL,              -- e.g. "/pricing"
  viewport      INTEGER NOT NULL,           -- width in px
  dev_url       TEXT NOT NULL,
  prod_url      TEXT NOT NULL,
  dev_image     BLOB,                       -- full-page PNG (dev)
  prod_image    BLOB,                       -- full-page PNG (prod)
  diff_image    BLOB,                       -- pixelmatch output PNG
  width         INTEGER,                    -- captured image dims (post-normalize)
  height        INTEGER,
  diff_pixels   INTEGER,                    -- changed pixel count
  diff_score    REAL,                       -- 0..1 fraction changed
  passed        INTEGER,                    -- 0/1 vs threshold
  status        TEXT NOT NULL,              -- 'ok' | 'error'
  error         TEXT,                       -- capture/diff failure detail, if any
  UNIQUE(run_id, path, viewport)
);

CREATE INDEX idx_comparisons_score ON comparisons(run_id, diff_score DESC);
```

### Notes / decisions

- **Images as BLOBs**, per the no-filesystem preference. PNG is already
  compressed; gzip of the BLOB is deferred (YAGNI) unless DB size becomes a
  problem.
- **A row is created early** with `status='error'` / null images if capture
  fails, so the report can show "this page failed on dev" rather than silently
  dropping it.
- `diff_score = diff_pixels / (width × height)`; `passed` compares it to the
  resolved threshold (per-path override falling back to global `failScore`).
- SQLite opened in WAL mode; all writes on the main thread.

## 6. Configuration

`momus.config.ts` exports a typed object, validated by Zod at load time.

```ts
import { defineConfig } from "./src/config/schema";

export default defineConfig({
  dev:  "https://dev.example.com",
  prod: "https://www.example.com",

  discovery: {
    sitemap: true,               // try {prod}/sitemap.xml first
    crawl: { enabled: true, startPath: "/", maxDepth: 3, maxPages: 500 },
    include: ["/**"],            // glob allow-list of paths
    exclude: ["/admin/**"],     // glob deny-list
  },

  viewports: [375, 768, 1280],   // widths; full-page height each

  stabilize: {
    waitUntil: "networkidle",
    settleMs: 500,               // extra delay after idle
    timeoutMs: 15000,            // hard cap on nav + network-idle wait; capture anyway on expiry
    disableAnimations: true,
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],  // hidden before shot
  },

  diff: {
    threshold: 0.1,              // pixelmatch per-pixel AA sensitivity (0..1)
    failScore: 0.01,             // page fails if >1% pixels differ
    overrides: [                 // per-path tuning
      { path: "/blog/**", failScore: 0.05 },
    ],
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html" },
});
```

### Resolution order (highest precedence wins)

CLI flags → config file → built-in defaults. `--dev`, `--prod`, `--out`,
`--crawl`, `--concurrency` override the file; everything else lives in the file.
`momus init` writes a commented starter config.

### Two distinct threshold knobs (named to avoid confusion)

- `diff.threshold` — pixelmatch's **per-pixel** color/anti-aliasing sensitivity
  (how different two pixels must be to count as changed).
- `diff.failScore` — the **page-level** gate (what fraction of changed pixels
  flips a page to "fail").

### Path globs

`include` / `exclude` / override `path` are matched against the URL path via a
single internal predicate `matchPath(path: string, pattern: string): boolean`.
This interface is pinned regardless of the backing implementation (`picomatch`
vs. a tiny inline matcher, decided during implementation), so glob-matching and
override-resolution tests target the predicate, not the library.

### Output overwrite behavior

Both the SQLite DB and the HTML report at the configured `output.report` path are
**overwritten** if they already exist (consistent with single-run mode). momus
does not prompt or refuse; it is safe to re-run repeatedly to the same paths.

## 7. Error Handling & Edge Cases

- **Full-page dimension mismatch (primary concern).** Dev and prod full-page
  screenshots usually differ in height (and possibly width). pixelmatch requires
  identical dimensions. **Normalize by padding** the smaller image with
  transparent pixels up to the max width×height of the pair before diffing —
  never scale (scaling corrupts the comparison). The padded region legitimately
  shows as a diff (the page changed size). The report notes when dimensions
  differed.
- **Page fails to load on one side** (404, timeout, DNS): record the comparison
  row with `status='error'` + message, compute no diff, surface it in the report
  as an explicit error card. One bad page never aborts the run.
- **`networkidle` never settles** (long-polling, analytics beacons): cap the
  stabilize wait with the `stabilize.timeoutMs` hard timeout (default 15000ms),
  then capture anyway and log a warning on that comparison.
- **Browser missing / wrong version:** `momus run` checks for the pinned Chromium
  up front; if absent, print a clear message pointing to `momus install-browser`
  and exit non-zero (no silent auto-download mid-run — explicit is friendlier in
  CI).
- **Sitemap absent or malformed:** fall back to crawl if enabled; if neither
  yields URLs, exit non-zero with a clear "no pages discovered" message.
- **Worker crash in the diff pool:** the pool detects the dead worker, marks that
  comparison `status='error'`, and respawns a replacement so the run continues.
- **Partial-run durability:** open a fresh DB each run (single-run mode
  overwrites); commit per-comparison so a mid-run crash leaves a readable partial
  DB.

### Exit codes

- `0` — ran and all pages passed.
- `1` — ran, but one or more pages failed the diff gate (CI regression signal).
- `2` — operational error (no browser, no URLs discovered, invalid config).

This makes momus CI-gateable even though HTML is the primary output.

## 8. Testing Strategy

Using `bun:test`. Browser/network are kept out of most tests by isolating pure
logic behind interfaces.

### Pure unit tests (no browser, no network) — the bulk of coverage

- `sitemap.ts` — parse fixture XML (flat + nested index) → expected paths.
- `crawler.ts` — canned HTML → assert same-domain BFS, depth/maxPages limits,
  dedupe.
- `config/*` — Zod validation, defaults, **flag-override precedence**.
- `diff/worker.ts` — two known PNG fixtures (identical, 1-pixel-off, different
  sizes) → assert score and that padding/normalization engages on mismatch.
- Glob include/exclude matching; threshold/override resolution; exit-code
  selection.
- `report/template.ts` — fake rows → assert HTML contains the pages and is
  self-contained (no external `src=`/`href=` to the network).

### Integration test (local server, not the internet)

Serve two tiny static sites from fixtures (a "dev" and "prod" that differ on one
page) via `Bun.serve`, run the real pipeline headless against them, and assert
the DB has the right comparisons and the changed page is flagged. Exercises
discovery → capture → diff → persist → report end-to-end, deterministically.

### De-risking spike (do FIRST)

Before building features: launch Playwright, screenshot one page, then
`bun build --compile` it and run the **binary** to confirm the bundled-browser
path works from a compiled artifact. If Playwright fights `--compile`, switch the
`capture/` module to `puppeteer-core` — contained to one module because
everything behind `screenshot.ts`'s interface is browser-agnostic.

## 9. Build Order (Milestones)

1. Playwright + `bun build --compile` spike (de-risk the single binary).
2. Config load + Zod + CLI skeleton (`init`, `run`, `install-browser`).
3. Discovery (sitemap → crawl fallback, include/exclude globs).
4. Capture + stabilize (single page, single viewport).
5. SQLite store.
6. Diff worker + pool (with padding/normalization).
7. Pipeline wiring + concurrency (queue/semaphore, backpressure).
8. HTML report.
9. End-to-end integration test + polish.

## 10. Open Risks

- **Playwright inside `bun build --compile`** is the main technical risk (it
  normally spawns a driver process). Mitigated by the first-milestone spike and a
  `puppeteer-core` fallback isolated to `capture/`.
- **Full-page screenshot size** across 3 viewports × many pages may grow the DB;
  BLOB gzip is a known lever if needed (deferred).
- **Dynamic content** beyond selector masking (e.g. randomized layouts) can still
  produce diffs; acceptable for v1, ignore-regions deferred.
