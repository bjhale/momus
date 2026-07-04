# Unify `run` Into One Ensure-Baseline Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `momus run`'s one-shot and baseline branches into a single "ensure a prod baseline exists (materializing one in-invocation if absent), then diff live dev against it" path, with correct prod provenance.

**Architecture:** Extract the run orchestration into a testable `runFlow` function with injectable seams. `runFlow` reuses the existing `snapshotPipeline` to materialize a baseline when none exists (freeze-on-first-run), runs the existing `baselineConflict` check, then drives `runPipeline` with a store-backed prod source. `runPipeline` gains an optional `prodBaseUrl` so the run row (and thus the report) records where prod actually came from. `runCommand` becomes thin wiring over `runFlow`.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Playwright (playwright-core), pixelmatch, Zod. Tests via `bun test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test` (`import { test, expect } from "bun:test"`).
- `capture()` and `runPipeline` **never throw for one bad page**; failures become `status:"error"` rows (`dev:`/`prod:`/`diff:` prefixes).
- **Freeze semantics:** once a `run` materializes a prod baseline, later runs reuse it (no prod hit). Refresh is `momus snapshot` only — there is **no `--refresh` flag**.
- The baseline lives in the same `config.output.db`; `run` never deletes the DB file and preserves the baseline tables.
- A `run` in baseline conflict (live `viewports`/`stabilize` differ from the baseline's) exits **2** and does not diff.
- Prod provenance: the run row's `prod_base_url` must reflect the **baseline's** prod URL (`snapshot.prodBaseUrl`), not necessarily the live `config.prod`.
- Exit codes: `0` all pass, `1` any fail/error, `2` operational (no browser, bad config, discovery threw during materialize, baseline conflict).
- The existing `momus snapshot` command is unchanged.
- Commit after each task.

---

## File Structure

- `src/pipeline/run.ts` — **modify**: add optional `prodBaseUrl?: string` to `RunPipelineArgs`; `startRun` uses it (falls back to `config.prod`).
- `src/pipeline/run-flow.ts` — **create**: `runFlow` orchestration (ensure-baseline → conflict check → diff) with injectable `discover`/`captureProd`/`getDev`/`diffPool` seams. Returns a discriminated result.
- `src/commands/run.ts` — **modify**: delete the two-branch logic; wire real browser/discovery seams to `runFlow`; print baseline provenance; keep report + exit-code tail.
- Tests: `tests/pipeline/run-flow.test.ts` (new, no browser), `tests/e2e/run-flow.integration.test.ts` (new, browser-guarded), delete `tests/pipeline/baseline-roundtrip.test.ts` (subsumed by `run-flow.test.ts`), `README.md`.

---

## Task 1: Thread `prodBaseUrl` through `runPipeline`

**Files:**
- Modify: `src/pipeline/run.ts`
- Test: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: existing `startRun`, `RunPipelineArgs`, `Job`.
- Produces: `RunPipelineArgs` gains optional `prodBaseUrl?: string`; when provided, `runs.prod_base_url` is set to it, else to `config.prod` (unchanged default).

- [ ] **Step 1: Write the failing test**

Append to `tests/pipeline/run.test.ts`:

```typescript
test("prodBaseUrl arg overrides the run row's prod_base_url", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    prodBaseUrl: "https://frozen.example.com",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://frozen.example.com");
});

test("without prodBaseUrl the run row falls back to config.prod", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/"], [1280]),
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
  });

  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://www.example.com");
});
```

(Note: `jobs`, `okPng`, `okDiff` already exist as helpers at the top of this test file from the prior feature.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/pipeline/run.test.ts`
Expected: FAIL — the `prodBaseUrl` test sees `www.example.com` (the arg is ignored / not a known field yet).

- [ ] **Step 3: Add the optional field and use it**

In `src/pipeline/run.ts`, add the field to `RunPipelineArgs` (after `finishedAt?`):

```typescript
  /** Prod base URL to record on the run row. Defaults to config.prod. In
   * baseline mode this is the baseline's origin (snapshot.prodBaseUrl), so the
   * report labels prod correctly even when the live config prod differs. */
  prodBaseUrl?: string;
```

In `runPipeline`, change the `startRun` call:

```typescript
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: args.prodBaseUrl ?? config.prod,
    configJson: JSON.stringify(config), startedAt: args.startedAt,
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/pipeline/run.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/run.ts tests/pipeline/run.test.ts
git commit -m "feat: let runPipeline record an explicit prodBaseUrl on the run row"
```

---

## Task 2: `runFlow` orchestration (ensure-baseline → diff)

**Files:**
- Create: `src/pipeline/run-flow.ts`
- Test: `tests/pipeline/run-flow.test.ts`

**Interfaces:**
- Consumes: `readSnapshot`, `readBaselineImages`, `BaselineImageRow` (`src/store/db`); `snapshotPipeline` (`src/pipeline/snapshot`); `baselineConflict` (`src/pipeline/compat`); `runPipeline`, `Job`, `DiffPoolLike` (`src/pipeline/run`, all exported); `CaptureResult` (`src/types`); `ResolvedConfig` (`src/config/schema`).
- Produces:
  - `interface RunFlowArgs { config: ResolvedConfig; db: Database; now: string; discover: () => Promise<string[]>; captureProd: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>; getDev: (job: Job) => Promise<CaptureResult>; diffPool: DiffPoolLike }`
  - `type RunFlowResult = { ok: true; materialized: boolean; createdAt: string } | { ok: false; conflict: string }`
  - `runFlow(args: RunFlowArgs): Promise<RunFlowResult>`

- [ ] **Step 1: Write the failing tests**

Create `tests/pipeline/run-flow.test.ts`:

```typescript
// tests/pipeline/run-flow.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runFlow } from "../../src/pipeline/run-flow";
import { openDb, readComparisons, readSnapshot, readBaselineImages } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { DiffResponse } from "../../src/diff/worker";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}
const okDiff = (a: Uint8Array): DiffResponse => ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a });
const diffPool = { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} };

function cfg(over: Record<string, unknown> = {}) {
  return ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], ...over });
}

test("no baseline: materializes one AND diffs in a single invocation", async () => {
  const db = openDb(":memory:");
  const res = await runFlow({
    config: cfg(), db, now: "2026-07-04T10:00:00Z",
    discover: async () => ["/", "/pricing"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  expect(res).toEqual({ ok: true, materialized: true, createdAt: "2026-07-04T10:00:00Z" });
  // Baseline materialized...
  expect(readSnapshot(db)!.prodBaseUrl).toBe("https://www.example.com");
  expect(readBaselineImages(db).length).toBe(2);
  // ...and comparisons produced in the same call, prod from the fresh baseline BLOB.
  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2);
  for (const r of rows) { expect(r.status).toBe("ok"); expect(Array.from(r.prodImage!)).toEqual(Array.from(png(100))); }
});

test("second run freezes: no discovery, no prod re-capture, baseline reused", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const res = await runFlow({
    config: cfg(), db, now: "t2",
    discover: async () => { throw new Error("must not discover on a frozen baseline"); },
    captureProd: async () => { throw new Error("must not re-capture prod on a frozen baseline"); },
    getDev: async () => ({ ok: true, png: png(200) }),
    diffPool,
  });

  expect(res).toEqual({ ok: true, materialized: false, createdAt: "t1" });
  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(1);
  expect(rows[0]!.status).toBe("ok");
  // prod still the frozen baseline (png 100); dev is the new capture (png 200).
  expect(Array.from(rows[0]!.prodImage!)).toEqual(Array.from(png(100)));
  expect(Array.from(rows[0]!.devImage!)).toEqual(Array.from(png(200)));
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

test("run row records the baseline's prod URL, not the live config prod", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ prod: "https://frozen.example.com" }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const res = await runFlow({
    config: cfg({ prod: "https://live-different.example.com" }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  expect(res.ok).toBe(true);
  const row = db.query("SELECT prod_base_url FROM runs WHERE id = 1").get() as { prod_base_url: string };
  expect(row.prod_base_url).toBe("https://frozen.example.com");
});

test("conflict on changed viewports returns ok:false and skips the diff", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg({ viewports: [1280] }), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  let devCalls = 0;
  const res = await runFlow({
    config: cfg({ viewports: [375] }), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => { devCalls++; return { ok: true, png: png(150) }; },
    diffPool,
  });

  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.conflict.toLowerCase()).toContain("viewport");
  expect(devCalls).toBe(0); // diff never ran
});

test("a prod error row from materialize yields a prod: error comparison", async () => {
  const db = openDb(":memory:");
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/broken"],
    captureProd: async () => ({ ok: false, error: "404" }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });

  const rows = readComparisons(db, 1);
  expect(rows[0]!.status).toBe("error");
  expect(rows[0]!.error).toContain("prod: 404");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/pipeline/run-flow.test.ts`
Expected: FAIL — `runFlow` is not defined (import error).

- [ ] **Step 3: Implement `src/pipeline/run-flow.ts`**

```typescript
// src/pipeline/run-flow.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";
import { readSnapshot, readBaselineImages, type BaselineImageRow } from "../store/db";
import { snapshotPipeline } from "./snapshot";
import { baselineConflict } from "./compat";
import { runPipeline, type Job, type DiffPoolLike } from "./run";

export interface RunFlowArgs {
  config: ResolvedConfig;
  db: Database;
  /** Timestamp for both a materialized snapshot and the run row. */
  now: string;
  /** Discover prod paths — only called when a baseline must be materialized. */
  discover: () => Promise<string[]>;
  /** Capture a prod page — only called when materializing a baseline. */
  captureProd: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  /** Capture a dev page — always a live capture. */
  getDev: (job: Job) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
}

export type RunFlowResult =
  | { ok: true; materialized: boolean; createdAt: string }
  | { ok: false; conflict: string };

/** Ensure a prod baseline exists (capturing one in-invocation if absent), then
 * diff live dev against it. Freeze semantics: a baseline, once materialized, is
 * reused by later runs — refresh it with `momus snapshot`. */
export async function runFlow(args: RunFlowArgs): Promise<RunFlowResult> {
  const { config, db } = args;

  let snapshot = readSnapshot(db);
  let materialized = false;
  if (!snapshot) {
    // No baseline yet — materialize one now (discover + capture prod). Same
    // ordering guarantees as `momus snapshot`: discovery runs before any clear.
    await snapshotPipeline({
      config, db, createdAt: args.now,
      discover: args.discover,
      captureFn: args.captureProd,
    });
    snapshot = readSnapshot(db)!;
    materialized = true;
  }

  const conflict = baselineConflict(config, snapshot);
  if (conflict) return { ok: false, conflict };

  const images = readBaselineImages(db);
  const byKey = new Map<string, BaselineImageRow>(
    images.map((im) => [`${im.path} ${im.viewport}`, im]));

  await runPipeline({
    config, db, startedAt: args.now, prodBaseUrl: snapshot.prodBaseUrl,
    listJobs: async (): Promise<Job[]> => images.map((im) => ({
      path: im.path, viewport: im.viewport,
      devUrl: new URL(im.path, config.dev).toString(),
      prodUrl: im.prodUrl,
    })),
    getDev: args.getDev,
    getProd: async (job: Job) => {
      const im = byKey.get(`${job.path} ${job.viewport}`)!;
      return im.status === "ok" && im.image
        ? { ok: true, png: im.image }
        : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
    },
    diffPool: args.diffPool,
  });

  return { ok: true, materialized, createdAt: snapshot.createdAt };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/pipeline/run-flow.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/run-flow.ts tests/pipeline/run-flow.test.ts
git commit -m "feat: add runFlow — ensure a prod baseline then diff dev against it"
```

---

## Task 3: Rewire `runCommand` over `runFlow`; delete the two-branch logic

**Files:**
- Modify: `src/commands/run.ts`
- Delete: `tests/pipeline/baseline-roundtrip.test.ts` (its scenarios are subsumed by `run-flow.test.ts`; its header comment mirrors the now-deleted inline command wiring)
- Test: `tests/e2e/run-flow.integration.test.ts` (new, browser-guarded)

**Interfaces:**
- Consumes: `runFlow`, `RunFlowResult` (`src/pipeline/run-flow`); `Job` (`src/pipeline/run`); `capture`, `discoverPaths`, `DiffPool`, `openDb`, `readComparisons`, `readBaselineImages`, `writeReport`, `exitCodeFor`, config loaders (all existing).
- Produces: no new exports.

- [ ] **Step 1: Replace `src/commands/run.ts` with the unified wiring**

Replace the entire file `src/commands/run.ts` with:

```typescript
// src/commands/run.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons, readBaselineImages } from "../store/db";
import { runFlow, type RunFlowResult } from "../pipeline/run-flow";
import type { Job } from "../pipeline/run";
import { exitCodeFor } from "../pipeline/verdict";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";

export async function runCommand(parsed: ParsedCli): Promise<number> {
  if (!isBrowserInstalled()) {
    console.error("No browser found. Run `momus install-browser` first.");
    return 2;
  }

  const configPath = parsed.configPath ?? `${process.cwd()}/momus.config.ts`;
  let config: ResolvedConfig;
  try {
    const raw = await loadConfigFile(configPath);
    config = resolveConfig(raw, parsed.overrides);
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    return 2;
  }

  // Preserve the DB file across runs so a prod baseline is reused (freeze).
  // A run materializes a baseline on first use, then reuses it thereafter.
  const db = openDb(config.output.db);
  const browser = await launchBrowser();
  const diffPool = new DiffPool(config.concurrency.diffWorkers);

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  // Teardown runs in `finally` so both handles always close, even if one close
  // rejects: `browser.close()` must not be skipped when `diffPool.close()` fails.
  let result: RunFlowResult;
  try {
    result = await runFlow({
      config, db, now: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        // `--crawl` forces a link crawl even when prod has a sitemap: disable
        // sitemap discovery for this run so the crawl path is taken.
        sitemap: parsed.overrides.crawl ? false : config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
      getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize),
      diffPool,
    });
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    return 2;
  } finally {
    await diffPool.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!result.ok) {
    console.error(`Baseline conflict: ${result.conflict}`);
    return 2;
  }

  // Read comparisons once and reuse for both the report and the exit code.
  const rows = readComparisons(db, 1);
  await writeReport(db, 1, config.output.report, rows);
  const code = exitCodeFor(rows);
  // Make freezing explicit: say whether prod was captured now or reused.
  if (result.materialized) {
    console.log(`Captured prod baseline (${readBaselineImages(db).length} pages).`);
  } else {
    console.log(`Reused prod baseline from ${result.createdAt}. Refresh with \`momus snapshot\`.`);
  }
  db.close(); // flush WAL/SHM sidecars cleanly now that we're done writing.
  console.log(`Wrote ${config.output.report} (${rows.length} comparisons). Exit ${code}.`);
  return code;
}
```

- [ ] **Step 2: Delete the now-subsumed roundtrip test**

```bash
git rm tests/pipeline/baseline-roundtrip.test.ts
```

Rationale: `run-flow.test.ts` covers the same store-backed-prod diff, baseline-preserved, and prod-error-row scenarios through the real `runFlow` (not a hand-kept mirror of the command wiring).

- [ ] **Step 3: Run the full suite and typecheck to verify nothing regressed**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS. The `run-flow`, `snapshot`, `run`, `compat`, store, and CLI tests pass; the browser-guarded e2e tests run if Chromium is present (else skip). No references to the deleted test remain.

- [ ] **Step 4: Write the browser-guarded end-to-end freeze test**

Create `tests/e2e/run-flow.integration.test.ts`:

```typescript
// tests/e2e/run-flow.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons, readSnapshot, readBaselineImages } from "../../src/store/db";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema } from "../../src/config/schema";
import type { Job } from "../../src/pipeline/run";

const maybe = isBrowserInstalled() ? test : test.skip;

function serve(pages: Record<string, string>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const body = pages[path];
      if (body === undefined) return new Response("not found", { status: 404 });
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
  });
}

maybe("first run materializes prod baseline; second run freezes (no prod re-capture)", async () => {
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });
  const config = ConfigSchema.parse({
    dev: "http://localhost:1",   // per-job dev URLs are built from config.dev; overridden below via a dev server
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    // --- Run 1: dev matches prod. No baseline yet → materialize + diff. ---
    const dev1 = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
    });
    let res;
    try {
      res = await runFlow({
        config, db, now: "2026-07-04T10:00:00Z",
        discover: async () => ["/", "/about"],
        captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
        getDev: (job: Job) => capture(browser, `http://localhost:${dev1.port}${job.path}`, job.viewport, config.stabilize),
        diffPool: pool,
      });
    } finally { dev1.stop(); }

    expect(res).toEqual({ ok: true, materialized: true, createdAt: "2026-07-04T10:00:00Z" });
    expect(readBaselineImages(db).length).toBe(2);
    expect(readComparisons(db, 1).every((r) => r.passed)).toBe(true); // dev == prod

    // --- Run 2: dev changed /about. Baseline frozen → prod not re-captured. ---
    const dev2 = serve({
      "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
      "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
    });
    let res2;
    try {
      res2 = await runFlow({
        config, db, now: "2026-07-04T11:00:00Z",
        discover: async () => { throw new Error("must not discover on a frozen baseline"); },
        captureProd: async () => { throw new Error("must not re-capture prod on a frozen baseline"); },
        getDev: (job: Job) => capture(browser, `http://localhost:${dev2.port}${job.path}`, job.viewport, config.stabilize),
        diffPool: pool,
      });
    } finally { dev2.stop(); }

    expect(res2).toEqual({ ok: true, materialized: false, createdAt: "2026-07-04T10:00:00Z" });
    const rows = readComparisons(db, 1);
    expect(rows.find((r) => r.path === "/")!.passed).toBe(true);
    expect(rows.find((r) => r.path === "/about")!.passed).toBe(false); // changed vs frozen prod
    expect(readSnapshot(db)!.createdAt).toBe("2026-07-04T10:00:00Z"); // baseline preserved
  } finally {
    await pool.close(); await browser.close(); prod.stop();
  }
});
```

- [ ] **Step 5: Run the e2e test**

Run: `bun test tests/e2e/run-flow.integration.test.ts`
Expected: PASS if Chromium is installed (materialize on run 1; freeze on run 2 with the throwing prod seams never firing), else the test is skipped.

- [ ] **Step 6: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/run.ts tests/e2e/run-flow.integration.test.ts
git rm tests/pipeline/baseline-roundtrip.test.ts
git commit -m "refactor: unify run over runFlow — one ensure-baseline path, correct prod label"
```

---

## Task 4: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the `momus run` description for the unified freeze model**

In `README.md`, find the `### momus run [flags]` section. Replace its current auto-detect description (the paragraph beginning "Runs the pipeline against the configured `dev` build. momus **auto-detects** …" and its two bullets) with:

```markdown
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
```

- [ ] **Step 2: Update the `momus snapshot` description to name its refresh role**

In the `### momus snapshot [flags]` section, append this sentence to its
descriptive paragraph (the one ending "…store the prod images plus the capture
context (viewports + stabilize settings)."):

```markdown
Running `momus snapshot` again replaces the baseline — it is how you refresh the
frozen prod capture that `momus run` reuses.
```

- [ ] **Step 3: Update "How it works"**

In the "## How it works" section, replace the discovery note added under step 1
by the prior feature (the line beginning "With a stored baseline (`momus
snapshot`), discovery and prod capture are skipped …") with:

```markdown
   `momus run` captures this prod baseline itself on first use, then reuses it —
   discovery and prod capture run only when there is no baseline yet (or after
   `momus snapshot` refreshes it).
```

- [ ] **Step 4: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS (docs change touches no code).

```bash
git add README.md
git commit -m "docs: describe run's unified capture-then-freeze prod baseline model"
```

---

## Self-Review

**1. Spec coverage:**
- §1 unified flow (materialize-if-absent → conflict → diff; one-shot branch deleted; discovery only in snapshotPipeline) → Task 2 (`runFlow`) + Task 3 (command rewire, branch deleted). ✓
- §2 provenance (thread `snapshot.prodBaseUrl`; console fresh/reused wording) → Task 1 (`prodBaseUrl` arg) + Task 2 (passes it) + Task 3 (console output). ✓
- §3 seams kept (`listJobs`/`getDev`/`getProd` unchanged; `Job` reused) → Task 2 uses them; no revert. ✓
- §4 behavior & docs (freeze, refresh via snapshot) → Task 4. ✓
- §5 exit codes (0/1/2, conflict=2, materialize discovery failure=2) → Task 2 (`runFlow` returns `{ok:false}` on conflict → Task 3 returns 2; discovery throw propagates out of `runFlow` → command catch → 2). ✓
- §6 testing (materialize-in-run, freeze, conflict, provenance, prod-error-row, console wording) → Task 2 unit tests + Task 3 e2e. Console wording is asserted implicitly via Task 3 (the exact strings are in the command); no separate unit harness captures stdout, which is acceptable — the e2e exercises both branches through `result.materialized`. ✓

**2. Placeholder scan:** No TBD/TODO; every code/test step has full code. ✓

**3. Type consistency:** `RunFlowArgs`/`RunFlowResult`/`runFlow` defined in Task 2 and consumed with matching field names in Task 3 (`config`, `db`, `now`, `discover`, `captureProd`, `getDev`, `diffPool`; result `.ok`, `.materialized`, `.createdAt`, `.conflict`). `prodBaseUrl?` added in Task 1 and passed in Task 2. `snapshotPipeline`'s `captureFn` signature `(url, viewport, cfg) => Promise<CaptureResult>` matches `runFlow`'s `captureProd`. Store-key format `` `${path} ${viewport}` `` and prod-error string `"prod capture failed in snapshot"` are internal to `runFlow` (single source now — no mirror). ✓

**Note for the implementer:** after Task 3, `tests/e2e/pipeline.integration.test.ts` (the original one-shot e2e) still drives `runPipeline` directly with two live captures — that remains a valid pipeline test and is intentionally left unchanged. Do not delete it.
