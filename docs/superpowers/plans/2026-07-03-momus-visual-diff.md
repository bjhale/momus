# momus Visual-Diff CLI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `momus`, a Bun/TypeScript CLI (compiled to a single binary) that screenshots two deployments of a website, pixel-diffs matching pages across multiple viewports, and produces a self-contained HTML report.

**Architecture:** A producer→consumer pipeline: discover URLs (sitemap, crawl fallback) → capture full-page screenshots with Playwright using an async page pool (I/O-bound) → pixel-diff each pair in a Bun Worker pool (CPU-bound) → persist to `bun:sqlite` → render an HTML report. Browser/network are isolated behind interfaces so most logic is unit-testable without either.

**Tech Stack:** Bun, TypeScript, Playwright (Chromium), `pixelmatch` + `pngjs`, `bun:sqlite`, `zod`, `bun:test`. Binary via `bun build --compile`.

**Spec:** `docs/superpowers/specs/2026-07-03-momus-visual-diff-design.md`

---

## Conventions for the implementing engineer

- **You may not know Bun.** Bun is a Node-compatible JS/TS runtime. It runs `.ts` files directly (no separate compile step for dev). `bun test` is the test runner (Jest-like: `import { test, expect, describe } from "bun:test"`). `bun:sqlite` is a built-in synchronous SQLite driver. `Bun.serve()` starts an HTTP server. `bun build --compile` bundles everything into one executable.
- **TDD is mandatory.** For every task: write the failing test, run it and watch it fail for the *right reason*, write the minimal code, run it and watch it pass, commit. Never write implementation before a failing test.
- **Commit after every task** with the message shown in the task's final step.
- **Exact paths only.** All paths are relative to the repo root `/home/bjhale/projects/momus`.
- **Skills:** use superpowers:test-driven-development for each task and superpowers:systematic-debugging if a test fails unexpectedly.

---

## File Structure (created across all chunks)

| File | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `bunfig.toml` | Project setup, deps, TS config |
| `src/types.ts` | Shared domain types (`Job`, `CaptureResult`, `DiffResult`, `ResolvedConfig`, …) |
| `src/config/schema.ts` | Zod schema, `defineConfig()`, defaults |
| `src/config/load.ts` | Locate/import/validate config, apply CLI overrides |
| `src/glob.ts` | `matchPath(path, pattern)` predicate (single interface) |
| `src/discovery/sitemap.ts` | Fetch + parse sitemap(.xml / index) → URLs |
| `src/discovery/crawler.ts` | Same-domain BFS link crawl |
| `src/discovery/discover.ts` | Orchestrate sitemap→crawl→include/exclude→dedupe |
| `src/capture/browser.ts` | Playwright launch/context/teardown + browser presence check |
| `src/capture/stabilize.ts` | Wait, disable animations, mask selectors |
| `src/capture/screenshot.ts` | Capture one `(url, viewport)` → PNG buffer (browser-agnostic interface) |
| `src/diff/normalize.ts` | Pad two PNGs to common dimensions (pure) |
| `src/diff/diff.ts` | Run pixelmatch on normalized pair → diff PNG + score (pure) |
| `src/diff/worker.ts` | Bun Worker wrapper around `diff.ts` |
| `src/diff/pool.ts` | Worker pool: dispatch/collect, crash-respawn |
| `src/store/db.ts` | `bun:sqlite` open/migrate (DDL inlined as a const for `--compile` safety) + typed read/write helpers |
| `src/pipeline/queue.ts` | Bounded async queue + semaphore |
| `src/pipeline/verdict.ts` | Threshold/override resolution + exit-code helper |
| `src/pipeline/run.ts` | Wire discovery → screenshot pool → diff pool → persist |
| `src/report/template.ts` | Pure HTML string generation |
| `src/report/report.ts` | Read run from DB → write HTML file |
| `src/cli.ts` | Arg parsing, subcommands (`init`, `run`, `install-browser`) |
| `src/commands/init.ts` | Scaffold `momus.config.ts` |
| `src/commands/install.ts` | In-process Chromium install (the only downloader) |
| `src/commands/run.ts` | Wire config → discovery → pipeline → report |
| `src/index.ts` | Public package entry: re-exports `defineConfig` + config types (for `momus.config.ts`) |
| `build.ts` | `bun build --compile` wrapper |

---

## Chunk 0: Project setup + Playwright/compile spike

**Purpose:** Stand up the Bun project and de-risk the single-binary + Playwright combination *before* building features (spec §8, milestone 1).

### Task 0.1: Initialize the Bun project

**Files:**
- Create: `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore` (already exists — verify)

- [ ] **Step 1: Confirm Bun is installed**

Run: `bun --version`
Expected: prints a version (e.g. `1.x.x`). If "command not found", install with `curl -fsSL https://bun.sh/install | bash` then restart the shell.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "momus",
  "version": "0.1.0",
  "module": "src/cli.ts",
  "type": "module",
  "bin": { "momus": "src/cli.ts" },
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "scripts": {
    "test": "bun test",
    "build": "bun run build.ts",
    "momus": "bun run src/cli.ts"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/bun": "latest",
    "@types/pngjs": "^6.0.5"
  },
  "dependencies": {
    "playwright-core": "^1.48.0",
    "playwright": "^1.48.0",
    "pixelmatch": "^6.0.0",
    "pngjs": "^7.0.0",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `bun install`
Expected: creates a lockfile (`bun.lock` on Bun 1.2+, else `bun.lockb`) and `node_modules/`, no errors.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src", "tests", "build.ts"]
}
```

- [ ] **Step 5: Create `bunfig.toml`**

```toml
[test]
# Bun test config placeholder; coverage can be enabled later.
```

- [ ] **Step 6: Verify `.gitignore` covers build artifacts**

Confirm `.gitignore` contains `node_modules/`, `*.sqlite`, `momus-report.html`, `dist/`, and the compiled binary name `momus`. (It was created during brainstorming — add any missing lines.)

- [ ] **Step 7: Commit**

```bash
# Bun 1.2+ writes a text `bun.lock`; older Bun writes binary `bun.lockb`.
# `git add -A` commits whichever exists (node_modules etc. are gitignored).
git add -A
git commit -m "chore: initialize Bun + TypeScript project"
```

### Task 0.2: Smoke-test Bun test runner

**Files:**
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write a trivial test**

```ts
import { test, expect } from "bun:test";

test("bun test runner works", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: Run it**

Run: `bun test tests/smoke.test.ts`
Expected: 1 pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke.test.ts
git commit -m "test: add bun test-runner smoke test"
```

### Task 0.3: Playwright screenshot spike (dev-run)

**Files:**
- Create: `spike/screenshot-spike.ts`

- [ ] **Step 1: Install the Chromium browser for Playwright**

Run: `bunx playwright install chromium`
Expected: downloads Chromium into Playwright's cache. Note the printed cache path for later reference.

- [ ] **Step 2: Write the spike script**

```ts
// spike/screenshot-spike.ts
import { chromium } from "playwright-core";
import { executablePath } from "playwright";

const browser = await chromium.launch({ executablePath: executablePath() });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("https://example.com", { waitUntil: "networkidle" });
const buf = await page.screenshot({ fullPage: true });
await browser.close();
console.log(`captured ${buf.length} bytes`);
if (buf.length < 1000) throw new Error("screenshot suspiciously small");
```

- [ ] **Step 3: Run the spike under `bun run`**

Run: `bun run spike/screenshot-spike.ts`
Expected: prints `captured <N> bytes` with N in the tens of thousands. Confirms Playwright drives Chromium under Bun.

### Task 0.4: Compile spike (the real risk)

**Files:**
- Modify: `spike/screenshot-spike.ts` (no change needed)

- [ ] **Step 1: Compile the spike to a binary**

Run: `bun build spike/screenshot-spike.ts --compile --outfile spike-bin`
Expected: produces an executable `spike-bin`. If it errors on bundling Playwright, record the exact error.

- [ ] **Step 2: Run the compiled binary**

Run: `./spike-bin`
Expected: prints `captured <N> bytes`. **This is the go/no-go gate.**

- [ ] **Step 3: Record the outcome and decide**

- If it printed bytes: Playwright-under-`--compile` works. Proceed with `playwright`/`playwright-core` as planned.
- If it failed (e.g. driver/executable path not found in the compiled binary): switch `src/capture/browser.ts` to `puppeteer-core` + a system/downloaded Chrome. The `screenshot.ts` interface (defined in Chunk 3) stays identical, so only `browser.ts` changes. Document the decision in a comment at the top of `src/capture/browser.ts` when you create it.

Write a one-paragraph note of the result to `spike/RESULT.md`.

- [ ] **Step 4: Clean up and commit the spike result**

```bash
rm -f spike-bin
git add spike/screenshot-spike.ts spike/RESULT.md
git commit -m "chore: Playwright + bun --compile de-risking spike"
```

---

## Chunk 1: Shared types, config schema & loader, glob

**Purpose:** The typed foundation everything else imports (spec §6). No browser/network.

### Task 1.1: Shared domain types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/types.ts
export interface Viewport { width: number }

/** A single unit of work: one path at one viewport width. */
export interface Job {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
}

/** Raw PNG capture for one side of a Job. */
export interface CaptureResult {
  ok: boolean;
  png?: Uint8Array;
  error?: string;
}

/** Result of diffing a captured pair. */
export interface DiffResult {
  width: number;
  height: number;
  diffPixels: number;
  diffScore: number;   // diffPixels / (width*height), 0..1
  diffPng: Uint8Array;
}

/** A fully processed comparison ready to persist. */
export interface ComparisonRecord {
  path: string;
  viewport: number;
  devUrl: string;
  prodUrl: string;
  devImage?: Uint8Array;
  prodImage?: Uint8Array;
  diffImage?: Uint8Array;
  width?: number;
  height?: number;
  diffPixels?: number;
  diffScore?: number;
  passed?: boolean;
  status: "ok" | "error";
  error?: string;
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no type errors. (`tsc --noEmit` genuinely type-checks; `bun build` only transpiles and would not catch type errors. `typescript` is in devDependencies.)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared domain types"
```

### Task 1.2: `matchPath` glob predicate

**Files:**
- Create: `src/glob.ts`
- Test: `tests/glob.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/glob.test.ts
import { test, expect } from "bun:test";
import { matchPath } from "../src/glob";

test("exact match", () => {
  expect(matchPath("/pricing", "/pricing")).toBe(true);
  expect(matchPath("/pricing", "/about")).toBe(false);
});

test("single-segment wildcard * does not cross /", () => {
  expect(matchPath("/blog/post", "/blog/*")).toBe(true);
  expect(matchPath("/blog/post/comments", "/blog/*")).toBe(false);
});

test("globstar ** crosses segments", () => {
  expect(matchPath("/blog/post/comments", "/blog/**")).toBe(true);
  expect(matchPath("/blog", "/blog/**")).toBe(true);
  expect(matchPath("/admin", "/**")).toBe(true);
});

test("bare and mid-pattern globstar (regression guards)", () => {
  // bare ** (not preceded by /) still crosses segments
  expect(matchPath("/x/foo", "**/foo")).toBe(true);
  // mid-pattern /**/ backtracks for both zero and many intermediate segments
  expect(matchPath("/a/b", "/a/**/b")).toBe(true);
  expect(matchPath("/a/x/y/b", "/a/**/b")).toBe(true);
  expect(matchPath("/a/b/c", "/a/**/b")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/glob.test.ts`
Expected: FAIL — `matchPath` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/glob.ts
// Tiny glob matcher for URL paths. Interface is pinned regardless of backing
// implementation (spec §6). Supports: literal text, `*` (any chars except `/`),
// `**` (any chars including `/`).
export function matchPath(path: string, pattern: string): boolean {
  const rx = globToRegExp(pattern);
  return rx.test(path);
}

function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "/" && pattern[i + 1] === "*" && pattern[i + 2] === "*") {
      // "/**" matches an empty suffix OR "/anything", so "/blog/**" matches both
      // "/blog" and "/blog/post/comments". Consumes the slash + both stars.
      re += "(?:/.*)?";
      i += 2;
    } else if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"; // bare globstar: cross segments
        i++;
      } else {
        re += "[^/]*"; // single segment
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/glob.test.ts`
Expected: PASS (3 tests). Note the `/**` sequence is special-cased to `(?:/.*)?` so `/blog/**` matches both `/blog` and `/blog/post/comments`.

- [ ] **Step 5: Commit**

```bash
git add src/glob.ts tests/glob.test.ts
git commit -m "feat: add matchPath glob predicate"
```

### Task 1.3: Config schema + `defineConfig` + defaults

**Files:**
- Create: `src/config/schema.ts`
- Test: `tests/config/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/schema.test.ts
import { test, expect } from "bun:test";
import { ConfigSchema, defineConfig, applyDefaults } from "../../src/config/schema";

test("minimal config validates and gets defaults", () => {
  const parsed = ConfigSchema.parse({
    dev: "https://dev.example.com",
    prod: "https://www.example.com",
  });
  const c = applyDefaults(parsed);
  expect(c.viewports).toEqual([375, 768, 1280]);
  expect(c.diff.failScore).toBe(0.01);
  expect(c.concurrency.screenshots).toBe(6);
  expect(c.stabilize.timeoutMs).toBe(15000);
});

test("invalid url is rejected", () => {
  expect(() => ConfigSchema.parse({ dev: "not-a-url", prod: "https://x.com" }))
    .toThrow();
});

test("defineConfig is an identity passthrough", () => {
  const raw = { dev: "https://a.com", prod: "https://b.com" };
  expect(defineConfig(raw)).toBe(raw);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/schema.ts
import { z } from "zod";

export const ConfigSchema = z.object({
  dev: z.string().url(),
  prod: z.string().url(),
  discovery: z.object({
    sitemap: z.boolean().default(true),
    crawl: z.object({
      enabled: z.boolean().default(true),
      startPath: z.string().default("/"),
      maxDepth: z.number().int().positive().default(3),
      maxPages: z.number().int().positive().default(500),
    }).default({}),
    include: z.array(z.string()).default(["/**"]),
    exclude: z.array(z.string()).default([]),
  }).default({}),
  viewports: z.array(z.number().int().positive()).default([375, 768, 1280]),
  stabilize: z.object({
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
    settleMs: z.number().int().nonnegative().default(500),
    timeoutMs: z.number().int().positive().default(15000),
    disableAnimations: z.boolean().default(true),
    mask: z.array(z.string()).default([]),
  }).default({}),
  diff: z.object({
    threshold: z.number().min(0).max(1).default(0.1),
    failScore: z.number().min(0).max(1).default(0.01),
    overrides: z.array(z.object({
      path: z.string(),
      failScore: z.number().min(0).max(1),
    })).default([]),
  }).default({}),
  concurrency: z.object({
    screenshots: z.number().int().positive().default(6),
    diffWorkers: z.number().int().positive().default(4),
  }).default({}),
  output: z.object({
    report: z.string().default("momus-report.html"),
    db: z.string().default("momus.sqlite"),
  }).default({}),
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type ResolvedConfig = z.output<typeof ConfigSchema>;

/** Typed helper for momus.config.ts authors. Identity at runtime. */
export function defineConfig(config: RawConfig): RawConfig {
  return config;
}

/** Zod already fills defaults on parse; this is an explicit re-parse for callers
 * holding an already-parsed object plus a stable name for tests. */
export function applyDefaults(config: ResolvedConfig): ResolvedConfig {
  return ConfigSchema.parse(config);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat: add config zod schema, defaults, defineConfig"
```

### Task 1.3a: Public package entry (`src/index.ts`)

**Files:**
- Create: `src/index.ts`

> This is what the `exports` map in `package.json` points at, so a user's `momus.config.ts` can `import { defineConfig } from "momus"` and get types + autocomplete. Trivial re-export; no test needed beyond the type-check.

- [ ] **Step 1: Write the re-export**

```ts
// src/index.ts
export { defineConfig } from "./config/schema";
export type { RawConfig, ResolvedConfig } from "./config/schema";
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add public package entry re-exporting defineConfig"
```

### Task 1.4: Config loader with CLI override precedence

**Files:**
- Create: `src/config/load.ts`
- Test: `tests/config/load.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config/load.test.ts
import { test, expect } from "bun:test";
import { resolveConfig } from "../../src/config/load";

const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };

test("CLI flags override file values", () => {
  const c = resolveConfig(base, {
    dev: "https://override-dev.com",
    out: "custom.html",
    concurrency: 12,
    crawl: true,
  });
  expect(c.dev).toBe("https://override-dev.com");
  expect(c.output.report).toBe("custom.html");
  expect(c.concurrency.screenshots).toBe(12); // --concurrency maps to screenshots only
  expect(c.concurrency.diffWorkers).toBe(4);  // untouched
  expect(c.discovery.crawl.enabled).toBe(true);
});

test("no overrides yields file + defaults", () => {
  const c = resolveConfig(base, {});
  expect(c.dev).toBe("https://dev.example.com");
  expect(c.output.report).toBe("momus-report.html");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/load.ts
import { ConfigSchema, type RawConfig, type ResolvedConfig } from "./schema";

export interface CliOverrides {
  dev?: string;
  prod?: string;
  out?: string;
  concurrency?: number;
  crawl?: boolean;
}

/** Merge file config + CLI overrides, then validate. CLI wins (spec §6). */
export function resolveConfig(fileConfig: RawConfig, cli: CliOverrides): ResolvedConfig {
  const merged: RawConfig = structuredClone(fileConfig);
  if (cli.dev !== undefined) merged.dev = cli.dev;
  if (cli.prod !== undefined) merged.prod = cli.prod;
  if (cli.out !== undefined) {
    merged.output = { ...(merged.output ?? {}), report: cli.out };
  }
  if (cli.concurrency !== undefined) {
    merged.concurrency = { ...(merged.concurrency ?? {}), screenshots: cli.concurrency };
  }
  if (cli.crawl !== undefined) {
    merged.discovery = {
      ...(merged.discovery ?? {}),
      crawl: { ...(merged.discovery?.crawl ?? {}), enabled: cli.crawl },
    };
  }
  return ConfigSchema.parse(merged);
}

/** Locate and import a config file, returning the raw (unvalidated) object.
 * Supports .ts/.js (default export) and .json. */
export async function loadConfigFile(path: string): Promise<RawConfig> {
  if (path.endsWith(".json")) {
    return (await Bun.file(path).json()) as RawConfig;
  }
  const mod = await import(path);
  return (mod.default ?? mod) as RawConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config/load.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/load.ts tests/config/load.test.ts
git commit -m "feat: add config loader with CLI override precedence"
```

---

## Chunk 2: Discovery (sitemap + crawl + orchestration)

**Purpose:** Turn base URLs into a deduped, filtered set of paths (spec §3 stage 1, §7 sitemap handling). Network is injected as a `fetch`-like function so tests use fixtures, not the internet.

### Task 2.1: Sitemap parser

**Files:**
- Create: `src/discovery/sitemap.ts`
- Test: `tests/discovery/sitemap.test.ts`
- Create fixtures: `tests/fixtures/sitemap-flat.xml`, `tests/fixtures/sitemap-index.xml`, `tests/fixtures/sitemap-child.xml`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/sitemap-flat.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.example.com/</loc></url>
  <url><loc>https://www.example.com/pricing</loc></url>
  <url><loc>https://www.example.com/about</loc></url>
</urlset>
```

`tests/fixtures/sitemap-index.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.example.com/sitemap-child.xml</loc></sitemap>
</sitemapindex>
```

`tests/fixtures/sitemap-child.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.example.com/blog/post-1</loc></url>
</urlset>
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/discovery/sitemap.test.ts
import { test, expect } from "bun:test";
import { fetchSitemapPaths } from "../../src/discovery/sitemap";

function fakeFetch(map: Record<string, string>) {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

test("parses a flat sitemap into paths", async () => {
  const xml = await Bun.file("tests/fixtures/sitemap-flat.xml").text();
  const fetcher = fakeFetch({ "https://www.example.com/sitemap.xml": xml });
  const paths = await fetchSitemapPaths("https://www.example.com", fetcher);
  expect(paths.sort()).toEqual(["/", "/about", "/pricing"]);
});

test("recurses into a sitemap index", async () => {
  const index = await Bun.file("tests/fixtures/sitemap-index.xml").text();
  const child = await Bun.file("tests/fixtures/sitemap-child.xml").text();
  const fetcher = fakeFetch({
    "https://www.example.com/sitemap.xml": index,
    "https://www.example.com/sitemap-child.xml": child,
  });
  const paths = await fetchSitemapPaths("https://www.example.com", fetcher);
  expect(paths).toEqual(["/blog/post-1"]);
});

test("returns empty array when sitemap missing", async () => {
  const paths = await fetchSitemapPaths("https://www.example.com", fakeFetch({}));
  expect(paths).toEqual([]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/discovery/sitemap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/discovery/sitemap.ts

/** Minimal fetch shape so tests can inject fixtures. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function extractLocs(xml: string): string[] {
  // matchAll avoids stateful RegExp; each match's group 1 is the <loc> content.
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
}

function toPath(base: string, url: string): string | null {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.host !== b.host) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/** Fetch {base}/sitemap.xml, recursing into sitemap-index files, return paths. */
export async function fetchSitemapPaths(base: string, fetcher: Fetcher): Promise<string[]> {
  const start = new URL("/sitemap.xml", base).toString();
  const seen = new Set<string>();
  const paths = new Set<string>();

  async function visit(sitemapUrl: string, depth: number): Promise<void> {
    if (depth > 5 || seen.has(sitemapUrl)) return;
    seen.add(sitemapUrl);
    const res = await fetcher(sitemapUrl);
    if (!res.ok) return;
    const xml = await res.text();
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = extractLocs(xml);
    if (isIndex) {
      for (const child of locs) await visit(child, depth + 1);
    } else {
      for (const loc of locs) {
        const p = toPath(base, loc);
        if (p) paths.add(p);
      }
    }
  }

  await visit(start, 0);
  return [...paths];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/discovery/sitemap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/discovery/sitemap.ts tests/discovery/sitemap.test.ts tests/fixtures/sitemap-flat.xml tests/fixtures/sitemap-index.xml tests/fixtures/sitemap-child.xml
git commit -m "feat: add sitemap parser with index recursion"
```

### Task 2.2: Link crawler (BFS, same-domain)

**Files:**
- Create: `src/discovery/crawler.ts`
- Test: `tests/discovery/crawler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/discovery/crawler.test.ts
import { test, expect } from "bun:test";
import { crawlPaths } from "../../src/discovery/crawler";
import type { Fetcher } from "../../src/discovery/sitemap";

function html(links: string[]): string {
  return `<html><body>${links.map((h) => `<a href="${h}">x</a>`).join("")}</body></html>`;
}

function fakeFetch(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
}

test("BFS discovers same-domain links up to depth", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "https://other.com/x"]),
    "https://www.example.com/a": html(["/c"]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", "/", {
    maxDepth: 2, maxPages: 100,
  }, fetcher);
  expect(paths.sort()).toEqual(["/", "/a", "/b", "/c"]);
});

test("respects maxPages", async () => {
  const fetcher = fakeFetch({
    "https://www.example.com/": html(["/a", "/b", "/c"]),
    "https://www.example.com/a": html([]),
    "https://www.example.com/b": html([]),
    "https://www.example.com/c": html([]),
  });
  const paths = await crawlPaths("https://www.example.com", "/", {
    maxDepth: 5, maxPages: 2,
  }, fetcher);
  expect(paths.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/discovery/crawler.ts
import type { Fetcher } from "./sitemap";

export interface CrawlOptions { maxDepth: number; maxPages: number }

function extractHrefs(html: string): string[] {
  // matchAll avoids stateful RegExp; group 1 is the href value.
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!);
}

/** Same-domain breadth-first crawl. Returns discovered paths (incl. start). */
export async function crawlPaths(
  base: string,
  startPath: string,
  opts: CrawlOptions,
  fetcher: Fetcher,
): Promise<string[]> {
  const baseHost = new URL(base).host;
  const visited = new Set<string>();
  const result: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: startPath, depth: 0 }];

  while (queue.length > 0 && result.length < opts.maxPages) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const url = new URL(path, base).toString();
    const res = await fetcher(url);
    if (!res.ok) continue;
    result.push(path);
    if (result.length >= opts.maxPages) break;
    if (depth >= opts.maxDepth) continue;

    const body = await res.text();
    for (const href of extractHrefs(body)) {
      try {
        const abs = new URL(href, url);
        if (abs.host !== baseHost) continue;
        const childPath = abs.pathname + abs.search;
        if (!visited.has(childPath)) queue.push({ path: childPath, depth: depth + 1 });
      } catch { /* ignore malformed href */ }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/discovery/crawler.test.ts`
Expected: PASS (2 tests). Note: `maxPages` may include the start page; the test expects exactly 2 pages captured.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/crawler.ts tests/discovery/crawler.test.ts
git commit -m "feat: add same-domain BFS link crawler"
```

### Task 2.3: Discovery orchestrator (sitemap → crawl fallback → filter → dedupe)

**Files:**
- Create: `src/discovery/discover.ts`
- Test: `tests/discovery/discover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/discovery/discover.test.ts
import { test, expect } from "bun:test";
import { discoverPaths } from "../../src/discovery/discover";
import type { Fetcher } from "../../src/discovery/sitemap";

const fetcher: Fetcher = async () => ({ ok: false, status: 404, text: async () => "" });

test("filters via include/exclude and dedupes/sorts", async () => {
  // Sitemap is non-empty, so crawl is NOT used (it is a fallback). This test
  // exercises dedupe (two "/"), exclude ("/admin/**"), and sorting.
  const paths = await discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: ["/admin/**"],
    fetcher,
    _sitemapFn: async () => ["/pricing", "/", "/admin/secret", "/"],
    _crawlFn: async () => { throw new Error("crawl must not run when sitemap is non-empty"); },
  });
  expect(paths).toEqual(["/", "/pricing"]);
});

test("falls back to crawl when sitemap yields nothing", async () => {
  const paths = await discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: [],
    fetcher,
    _sitemapFn: async () => [],
    _crawlFn: async () => ["/", "/a"],
  });
  expect(paths).toEqual(["/", "/a"]);
});

test("throws when no pages discovered", async () => {
  await expect(discoverPaths({
    base: "https://www.example.com",
    sitemap: true,
    crawl: { enabled: false, startPath: "/", maxDepth: 2, maxPages: 50 },
    include: ["/**"],
    exclude: [],
    fetcher,
    _sitemapFn: async () => [],
    _crawlFn: async () => [],
  })).rejects.toThrow(/no pages discovered/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/discovery/discover.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/discovery/discover.ts
import { matchPath } from "../glob";
import { fetchSitemapPaths, type Fetcher } from "./sitemap";
import { crawlPaths, type CrawlOptions } from "./crawler";

export interface DiscoverArgs {
  base: string;
  sitemap: boolean;
  crawl: { enabled: boolean } & CrawlOptions & { startPath: string };
  include: string[];
  exclude: string[];
  fetcher: Fetcher;
  // Injectable seams for tests; default to the real implementations.
  _sitemapFn?: (base: string, fetcher: Fetcher) => Promise<string[]>;
  _crawlFn?: (base: string, start: string, opts: CrawlOptions, fetcher: Fetcher) => Promise<string[]>;
}

/** Discovery source of truth is the given base (spec §3: prod). */
export async function discoverPaths(args: DiscoverArgs): Promise<string[]> {
  const sitemapFn = args._sitemapFn ?? fetchSitemapPaths;
  const crawlFn = args._crawlFn ?? crawlPaths;

  let paths: string[] = [];
  if (args.sitemap) {
    paths = await sitemapFn(args.base, args.fetcher);
  }
  if (paths.length === 0 && args.crawl.enabled) {
    paths = await crawlFn(args.base, args.crawl.startPath,
      { maxDepth: args.crawl.maxDepth, maxPages: args.crawl.maxPages }, args.fetcher);
  }

  const filtered = paths.filter((p) =>
    args.include.some((g) => matchPath(p, g)) &&
    !args.exclude.some((g) => matchPath(p, g)));

  const deduped = [...new Set(filtered)].sort();
  if (deduped.length === 0) throw new Error("no pages discovered");
  return deduped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/discovery/discover.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/discovery/discover.ts tests/discovery/discover.test.ts
git commit -m "feat: add discovery orchestrator with crawl fallback and filtering"
```

---

## Chunk 3: Capture (browser, stabilize, screenshot)

**Purpose:** Capture one `(url, viewport)` → full-page PNG, with stabilization (spec §3 stage 3, §5). This is the browser-touching layer; its interface is browser-agnostic so the Chunk 0 spike's fallback (puppeteer-core) would only change `browser.ts`.

### Task 3.1: Stabilization helper (pure DOM-injection strings)

**Files:**
- Create: `src/capture/stabilize.ts`
- Test: `tests/capture/stabilize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/capture/stabilize.test.ts
import { test, expect } from "bun:test";
import { disableAnimationsCss, maskCss } from "../../src/capture/stabilize";

test("disableAnimationsCss zeroes animation + transition", () => {
  const css = disableAnimationsCss();
  expect(css).toContain("animation");
  expect(css).toContain("transition");
  expect(css).toContain("0s");
});

test("maskCss hides each selector", () => {
  const css = maskCss([".ad", ".carousel"]);
  expect(css).toContain(".ad");
  expect(css).toContain(".carousel");
  expect(css).toContain("visibility: hidden");
});

test("maskCss with empty list is empty string", () => {
  expect(maskCss([])).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/capture/stabilize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/stabilize.ts

/** CSS that neutralizes animations/transitions to avoid mid-animation captures. */
export function disableAnimationsCss(): string {
  return `*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }`;
}

/** CSS that hides masked selectors (dynamic content) before capture. */
export function maskCss(selectors: string[]): string {
  if (selectors.length === 0) return "";
  return `${selectors.join(", ")} { visibility: hidden !important; }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/capture/stabilize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capture/stabilize.ts tests/capture/stabilize.test.ts
git commit -m "feat: add stabilization CSS helpers"
```

### Task 3.2: Browser lifecycle + presence check

**Files:**
- Create: `src/capture/browser.ts`
- Test: `tests/capture/browser.test.ts`

> **Note:** If the Chunk 0 spike failed, implement this module against `puppeteer-core` instead, keeping the same exported functions. Add a top-of-file comment recording that decision.

- [ ] **Step 1: Write the failing test (presence check only — no real launch in unit tests)**

```ts
// tests/capture/browser.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled } from "../../src/capture/browser";

test("isBrowserInstalled returns a boolean", () => {
  // We can't guarantee install state in CI; just assert the contract.
  expect(typeof isBrowserInstalled()).toBe("boolean");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/capture/browser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/browser.ts
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { executablePath } from "playwright";
import { existsSync } from "node:fs";

/** True if the pinned Chromium executable exists on disk. */
export function isBrowserInstalled(): boolean {
  try {
    const p = executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath: executablePath(), headless: true });
}

export async function newContext(browser: Browser, viewportWidth: number): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/capture/browser.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/capture/browser.ts tests/capture/browser.test.ts
git commit -m "feat: add browser lifecycle and presence check"
```

### Task 3.3: Screenshot capture (interface + integration test with a local page)

**Files:**
- Create: `src/capture/screenshot.ts`
- Test: `tests/capture/screenshot.integration.test.ts`

> This is an **integration** test: it launches a real browser against a local `Bun.serve` page. If no browser is installed it must skip cleanly, not fail.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/capture/screenshot.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";

const maybe = isBrowserInstalled() ? test : test.skip;

maybe("captures a full-page PNG from a local server", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(
      "<html><body style='height:2000px'><h1>hi</h1></body></html>",
      { headers: { "content-type": "text/html" } }),
  });
  const url = `http://localhost:${server.port}/`;
  const browser = await launchBrowser();
  try {
    const res = await capture(browser, url, 1280, {
      waitUntil: "load", settleMs: 0, timeoutMs: 10000,
      disableAnimations: true, mask: [],
    });
    expect(res.ok).toBe(true);
    expect(res.png!.length).toBeGreaterThan(1000);
  } finally {
    await browser.close();
    server.stop();
  }
});

maybe("records a 404 as an error, not a capture", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("missing", { status: 404 }),
  });
  const url = `http://localhost:${server.port}/nope`;
  const browser = await launchBrowser();
  try {
    const res = await capture(browser, url, 1280, {
      waitUntil: "load", settleMs: 0, timeoutMs: 10000,
      disableAnimations: true, mask: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("404");
  } finally {
    await browser.close();
    server.stop();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/capture/screenshot.integration.test.ts`
Expected: FAIL — `capture` not found (or SKIP if no browser; install via `bunx playwright install chromium` first so it actually runs and fails on the import).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/capture/screenshot.ts
import type { Browser } from "playwright-core";
import { newContext } from "./browser";
import { disableAnimationsCss, maskCss } from "./stabilize";
import type { CaptureResult } from "../types";

export interface StabilizeOptions {
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  settleMs: number;
  timeoutMs: number;
  disableAnimations: boolean;
  mask: string[];
}

/** Capture a full-page PNG for one url at one viewport width. Never throws;
 * returns { ok:false, error } on failure so one bad page can't abort a run. */
export async function capture(
  browser: Browser,
  url: string,
  viewportWidth: number,
  opts: StabilizeOptions,
): Promise<CaptureResult> {
  const context = await newContext(browser, viewportWidth);
  const page = await context.newPage();
  // Single shared deadline so nav + settle together honor one `timeoutMs` cap
  // (spec §6), rather than allowing up to 2× the configured budget.
  const deadline = Date.now() + opts.timeoutMs;
  try {
    // Hard navigation: a genuine load failure (DNS, connection refused, nav
    // timeout) throws here and is recorded as an error (spec §7).
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    // An HTTP error (404/500/…) does NOT throw in Playwright — it returns a
    // response. Treat a non-2xx as a load failure per spec §7.
    if (response && !response.ok()) {
      return { ok: false, error: `HTTP ${response.status()} at ${url}` };
    }
    // Soft settle: if the page loaded but `load`/`networkidle` never settles
    // (long-polling, beacons), capture anyway rather than erroring (spec §7).
    // Use the REMAINING budget; skip if already exhausted (never pass 0 —
    // Playwright treats timeout:0 as "no timeout" / wait forever).
    const remaining = deadline - Date.now();
    if (opts.waitUntil !== "domcontentloaded" && remaining > 0) {
      try {
        await page.waitForLoadState(opts.waitUntil, { timeout: remaining });
      } catch {
        // network never went idle within budget — proceed to capture
      }
    }
    const css = [
      opts.disableAnimations ? disableAnimationsCss() : "",
      maskCss(opts.mask),
    ].filter(Boolean).join("\n");
    if (css) await page.addStyleTag({ content: css });
    if (opts.settleMs > 0) await page.waitForTimeout(opts.settleMs);
    const png = await page.screenshot({ fullPage: true, type: "png" });
    return { ok: true, png: new Uint8Array(png) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/capture/screenshot.integration.test.ts`
Expected: PASS (1 test), or SKIP if no browser installed. Install the browser and re-run to confirm a real PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capture/screenshot.ts tests/capture/screenshot.integration.test.ts
git commit -m "feat: add full-page screenshot capture with stabilization"
```

---

## Chunk 4: Diff (normalize, pixelmatch, worker, pool)

**Purpose:** Given two PNG buffers, normalize dimensions and compute a diff image + score (spec §5 dimension-mismatch padding), then parallelize via a Bun Worker pool (spec §3 stage 4).

### Task 4.1: Dimension normalization (pure)

**Files:**
- Create: `src/diff/normalize.ts`
- Test: `tests/diff/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/normalize.test.ts
import { test, expect } from "bun:test";
import { padToCommon } from "../../src/diff/normalize";

function solid(w: number, h: number, val: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(w * h * 4).fill(val);
  return { width: w, height: h, data };
}

test("pads both images to max width and height", () => {
  const a = solid(2, 2, 255);
  const b = solid(4, 3, 128);
  const { width, height, aData, bData } = padToCommon(a, b);
  expect(width).toBe(4);
  expect(height).toBe(3);
  expect(aData.length).toBe(4 * 3 * 4);
  expect(bData.length).toBe(4 * 3 * 4);
});

test("identical dimensions pass through unchanged", () => {
  const a = solid(2, 2, 255);
  const b = solid(2, 2, 0);
  const { width, height, aData, bData } = padToCommon(a, b);
  expect(width).toBe(2);
  expect(height).toBe(2);
  expect(aData[0]).toBe(255);
  expect(bData[0]).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/diff/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/diff/normalize.ts

export interface RawImage { width: number; height: number; data: Uint8Array }

/** Pad two RGBA images with transparent pixels to their common max dimensions.
 * Never scales (spec §5). Padded regions are transparent (0,0,0,0). */
export function padToCommon(a: RawImage, b: RawImage): {
  width: number; height: number; aData: Uint8Array; bData: Uint8Array;
} {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  return {
    width, height,
    aData: padImage(a, width, height),
    bData: padImage(b, width, height),
  };
}

function padImage(img: RawImage, width: number, height: number): Uint8Array {
  if (img.width === width && img.height === height) return img.data;
  const out = new Uint8Array(width * height * 4); // zero-filled = transparent
  for (let y = 0; y < img.height; y++) {
    const srcStart = y * img.width * 4;
    const dstStart = y * width * 4;
    out.set(img.data.subarray(srcStart, srcStart + img.width * 4), dstStart);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/diff/normalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/diff/normalize.ts tests/diff/normalize.test.ts
git commit -m "feat: add dimension-normalizing padding for diff"
```

### Task 4.2: Diff computation (pixelmatch, pure)

**Files:**
- Create: `src/diff/diff.ts`
- Test: `tests/diff/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/diff.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { diffPngs } from "../../src/diff/diff";

function pngBuffer(w: number, h: number, rgba: [number, number, number, number]): Uint8Array {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return new Uint8Array(PNG.sync.write(png));
}

test("identical images have zero diff", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 10, [255, 0, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.diffPixels).toBe(0);
  expect(r.diffScore).toBe(0);
});

test("fully different images have high score", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 10, [0, 255, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.diffPixels).toBe(100);
  expect(r.diffScore).toBeCloseTo(1, 5);
});

test("different-sized images are padded and diffed", () => {
  const a = pngBuffer(10, 10, [255, 0, 0, 255]);
  const b = pngBuffer(10, 20, [255, 0, 0, 255]);
  const r = diffPngs(a, b, 0.1);
  expect(r.width).toBe(10);
  expect(r.height).toBe(20);
  // The extra 10 rows differ (opaque red vs transparent padding).
  expect(r.diffPixels).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/diff/diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/diff/diff.ts
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { padToCommon } from "./normalize";
import type { DiffResult } from "../types";

/** Decode two PNG buffers, pad to common size, run pixelmatch, encode diff PNG. */
export function diffPngs(aPng: Uint8Array, bPng: Uint8Array, threshold: number): DiffResult {
  const a = PNG.sync.read(Buffer.from(aPng));
  const b = PNG.sync.read(Buffer.from(bPng));
  const { width, height, aData, bData } = padToCommon(
    { width: a.width, height: a.height, data: new Uint8Array(a.data) },
    { width: b.width, height: b.height, data: new Uint8Array(b.data) },
  );
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(aData, bData, out.data, width, height, {
    threshold, includeAA: false, alpha: 0.3,
  });
  const diffPng = new Uint8Array(PNG.sync.write(out));
  return {
    width, height, diffPixels,
    diffScore: diffPixels / (width * height),
    diffPng,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/diff/diff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/diff/diff.ts tests/diff/diff.test.ts
git commit -m "feat: add pixelmatch diff with padding and score"
```

### Task 4.3: Diff Worker

**Files:**
- Create: `src/diff/worker.ts`
- Test: `tests/diff/worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/worker.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";

function pngBuffer(w: number, h: number, v: number): Uint8Array {
  const png = new PNG({ width: w, height: h });
  png.data.fill(v);
  return new Uint8Array(PNG.sync.write(png));
}

test("worker computes a diff and posts it back", async () => {
  const worker = new Worker(new URL("../../src/diff/worker.ts", import.meta.url).href);
  const a = pngBuffer(8, 8, 255);
  const b = pngBuffer(8, 8, 0);

  const result = await new Promise<any>((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage({ id: 1, aPng: a, bPng: b, threshold: 0.1 });
  });

  expect(result.id).toBe(1);
  expect(result.ok).toBe(true);
  expect(result.diffPixels).toBeGreaterThan(0);
  worker.terminate();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/diff/worker.test.ts`
Expected: FAIL — worker module not found / no message.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/diff/worker.ts
import { diffPngs } from "./diff";

export interface DiffRequest { id: number; aPng: Uint8Array; bPng: Uint8Array; threshold: number }
export interface DiffResponse {
  id: number; ok: boolean;
  width?: number; height?: number; diffPixels?: number; diffScore?: number;
  diffPng?: Uint8Array; error?: string;
}

declare const self: Worker;

self.onmessage = (e: MessageEvent<DiffRequest>) => {
  const { id, aPng, bPng, threshold } = e.data;
  try {
    const r = diffPngs(aPng, bPng, threshold);
    const res: DiffResponse = {
      id, ok: true, width: r.width, height: r.height,
      diffPixels: r.diffPixels, diffScore: r.diffScore, diffPng: r.diffPng,
    };
    self.postMessage(res);
  } catch (err) {
    const res: DiffResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/diff/worker.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/diff/worker.ts tests/diff/worker.test.ts
git commit -m "feat: add diff worker"
```

### Task 4.4: Diff Worker pool (dispatch/collect + crash respawn)

**Files:**
- Create: `src/diff/pool.ts`
- Test: `tests/diff/pool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff/pool.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { DiffPool } from "../../src/diff/pool";

function pngBuffer(w: number, h: number, v: number): Uint8Array {
  const png = new PNG({ width: w, height: h });
  png.data.fill(v);
  return new Uint8Array(PNG.sync.write(png));
}

test("pool processes more jobs than workers", async () => {
  const pool = new DiffPool(2);
  const jobs = Array.from({ length: 5 }, (_, i) =>
    pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, i * 10), 0.1));
  const results = await Promise.all(jobs);
  expect(results.length).toBe(5);
  for (const r of results) expect(r.ok).toBe(true);
  await pool.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/diff/pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/diff/pool.ts
import type { DiffResponse } from "./worker";

interface Pending {
  aPng: Uint8Array; bPng: Uint8Array; threshold: number;
  resolve: (r: DiffResponse) => void;
}

/** Fixed-size pool of diff workers. Round-trips one job per worker at a time. */
export class DiffPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Pending[] = [];
  private inFlight = new Map<Worker, Pending>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    const w = new Worker(new URL("./worker.ts", import.meta.url).href);
    w.onmessage = (e: MessageEvent<DiffResponse>) => {
      const job = this.inFlight.get(w);
      this.inFlight.delete(w);
      if (job) job.resolve(e.data);
      this.idle.push(w);
      this.pump();
    };
    w.onerror = () => {
      // Worker crashed: fail its in-flight job, respawn a replacement.
      const job = this.inFlight.get(w);
      this.inFlight.delete(w);
      if (job) job.resolve({ id: -1, ok: false, error: "diff worker crashed" });
      this.workers = this.workers.filter((x) => x !== w);
      w.terminate();
      this.spawn();
      this.pump();
    };
    this.workers.push(w);
    this.idle.push(w);
  }

  submit(aPng: Uint8Array, bPng: Uint8Array, threshold: number): Promise<DiffResponse> {
    return new Promise((resolve) => {
      this.queue.push({ aPng, bPng, threshold, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.inFlight.set(w, job);
      w.postMessage({ id: this.nextId++, aPng: job.aPng, bPng: job.bPng, threshold: job.threshold });
    }
  }

  async close(): Promise<void> {
    for (const w of this.workers) w.terminate();
    this.workers = []; this.idle = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/diff/pool.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/diff/pool.ts tests/diff/pool.test.ts
git commit -m "feat: add diff worker pool with crash respawn"
```

---

## Chunk 5: Storage (SQLite schema + db helpers)

**Purpose:** Persist run metadata + comparisons (images as BLOBs), single-run overwrite (spec §5).

### Task 5.1: Schema DDL + DB open/migrate

**Files:**
- Create: `src/store/db.ts`
- Test: `tests/store/db.test.ts`

> **Why the DDL is inlined (not a `.sql` file):** loading a non-JS asset at runtime via `Bun.file(new URL("./schema.sql", import.meta.url))` works under `bun test` but is not guaranteed to be embedded by `bun build --compile`, so it could throw *only* in the shipped binary. Inlining the DDL as a `const` string keeps it inside the bundle and removes that risk.

- [ ] **Step 1: (schema is inlined in `db.ts` in Step 4 — no separate file)**

The DDL that `db.ts` will embed as a string constant:

```sql
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  dev_base_url  TEXT NOT NULL,
  prod_base_url TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comparisons (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  path          TEXT NOT NULL,
  viewport      INTEGER NOT NULL,
  dev_url       TEXT NOT NULL,
  prod_url      TEXT NOT NULL,
  dev_image     BLOB,
  prod_image    BLOB,
  diff_image    BLOB,
  width         INTEGER,
  height        INTEGER,
  diff_pixels   INTEGER,
  diff_score    REAL,
  passed        INTEGER,
  status        TEXT NOT NULL,
  error         TEXT,
  UNIQUE(run_id, path, viewport)
);

CREATE INDEX IF NOT EXISTS idx_comparisons_score ON comparisons(run_id, diff_score DESC);
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/store/db.test.ts
import { test, expect } from "bun:test";
import { openDb, startRun, saveComparison, finishRun, readComparisons } from "../../src/store/db";
import type { ComparisonRecord } from "../../src/types";

test("start run, save comparison, read back", () => {
  const db = openDb(":memory:");
  const runId = startRun(db, {
    devBaseUrl: "https://dev.example.com",
    prodBaseUrl: "https://www.example.com",
    configJson: "{}",
    startedAt: "2026-07-03T00:00:00Z",
  });
  expect(runId).toBe(1);

  const rec: ComparisonRecord = {
    path: "/pricing", viewport: 1280,
    devUrl: "https://dev.example.com/pricing",
    prodUrl: "https://www.example.com/pricing",
    devImage: new Uint8Array([1, 2, 3]),
    prodImage: new Uint8Array([4, 5, 6]),
    diffImage: new Uint8Array([7, 8, 9]),
    width: 1280, height: 2000, diffPixels: 42, diffScore: 0.01,
    passed: true, status: "ok",
  };
  saveComparison(db, runId, rec);
  finishRun(db, runId, "complete", "2026-07-03T00:01:00Z");

  const rows = readComparisons(db, runId);
  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toBe("/pricing");
  expect(rows[0]!.diffScore).toBe(0.01);
  expect(rows[0]!.devImage).toBeInstanceOf(Uint8Array);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/store/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/store/db.ts
import { Database } from "bun:sqlite";
import type { ComparisonRecord } from "../types";

// DDL inlined as a string constant (NOT read from a .sql file at runtime) so it
// is embedded in the `bun build --compile` binary. See the note above Step 1.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  dev_base_url  TEXT NOT NULL,
  prod_base_url TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comparisons (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs(id),
  path          TEXT NOT NULL,
  viewport      INTEGER NOT NULL,
  dev_url       TEXT NOT NULL,
  prod_url      TEXT NOT NULL,
  dev_image     BLOB,
  prod_image    BLOB,
  diff_image    BLOB,
  width         INTEGER,
  height        INTEGER,
  diff_pixels   INTEGER,
  diff_score    REAL,
  passed        INTEGER,
  status        TEXT NOT NULL,
  error         TEXT,
  UNIQUE(run_id, path, viewport)
);

CREATE INDEX IF NOT EXISTS idx_comparisons_score ON comparisons(run_id, diff_score DESC);
`;

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

export interface StartRunArgs {
  devBaseUrl: string; prodBaseUrl: string; configJson: string; startedAt: string;
}

export function startRun(db: Database, a: StartRunArgs): number {
  // Single-run mode: clear any prior run first.
  db.exec("DELETE FROM comparisons; DELETE FROM runs;");
  db.query(
    `INSERT INTO runs (id, started_at, dev_base_url, prod_base_url, config_json, status)
     VALUES (1, ?, ?, ?, ?, 'running')`,
  ).run(a.startedAt, a.devBaseUrl, a.prodBaseUrl, a.configJson);
  return 1;
}

export function saveComparison(db: Database, runId: number, r: ComparisonRecord): void {
  db.query(
    `INSERT OR REPLACE INTO comparisons
     (run_id, path, viewport, dev_url, prod_url, dev_image, prod_image, diff_image,
      width, height, diff_pixels, diff_score, passed, status, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId, r.path, r.viewport, r.devUrl, r.prodUrl,
    r.devImage ?? null, r.prodImage ?? null, r.diffImage ?? null,
    r.width ?? null, r.height ?? null, r.diffPixels ?? null, r.diffScore ?? null,
    r.passed === undefined ? null : (r.passed ? 1 : 0), r.status, r.error ?? null,
  );
}

export function finishRun(db: Database, runId: number, status: string, finishedAt: string): void {
  db.query(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`).run(status, finishedAt, runId);
}

export interface ComparisonRow extends ComparisonRecord { id: number }

export function readComparisons(db: Database, runId: number): ComparisonRow[] {
  const rows = db.query(
    `SELECT * FROM comparisons WHERE run_id = ? ORDER BY diff_score DESC`,
  ).all(runId) as any[];
  return rows.map((x) => ({
    id: x.id, path: x.path, viewport: x.viewport, devUrl: x.dev_url, prodUrl: x.prod_url,
    devImage: x.dev_image ? new Uint8Array(x.dev_image) : undefined,
    prodImage: x.prod_image ? new Uint8Array(x.prod_image) : undefined,
    diffImage: x.diff_image ? new Uint8Array(x.diff_image) : undefined,
    width: x.width ?? undefined, height: x.height ?? undefined,
    diffPixels: x.diff_pixels ?? undefined, diffScore: x.diff_score ?? undefined,
    passed: x.passed === null ? undefined : x.passed === 1,
    status: x.status, error: x.error ?? undefined,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/store/db.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/store/db.ts tests/store/db.test.ts
git commit -m "feat: add SQLite store with inlined schema and typed helpers"
```

---

## Chunk 6: Pipeline (queue/semaphore, verdict, run orchestration)

**Purpose:** Wire discovery → screenshot pool → diff pool → persist with bounded concurrency and backpressure (spec §3).

### Task 6.1: Bounded semaphore

**Files:**
- Create: `src/pipeline/queue.ts`
- Test: `tests/pipeline/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pipeline/queue.test.ts
import { test, expect } from "bun:test";
import { Semaphore, mapWithConcurrency } from "../../src/pipeline/queue";

test("semaphore bounds concurrent holders", async () => {
  const sem = new Semaphore(2);
  let active = 0, maxActive = 0;
  const task = async () => {
    await sem.acquire();
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--; sem.release();
  };
  await Promise.all(Array.from({ length: 6 }, task));
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("mapWithConcurrency preserves order and caps parallelism", async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapWithConcurrency(items, 2, async (n) => n * 2);
  expect(out).toEqual([2, 4, 6, 8, 10]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pipeline/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pipeline/queue.ts

/** Counting semaphore for bounding concurrency. */
export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    this.permits++;
    const next = this.waiters.shift();
    if (next) { this.permits--; next(); }
  }
}

/** Map over items with a bounded number of concurrent async calls, preserving
 * output order. Backpressure: at most `limit` fn() calls run at once. */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const sem = new Semaphore(limit);
  await Promise.all(items.map(async (item, i) => {
    await sem.acquire();
    try { results[i] = await fn(item, i); }
    finally { sem.release(); }
  }));
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pipeline/queue.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/queue.ts tests/pipeline/queue.test.ts
git commit -m "feat: add bounded semaphore and mapWithConcurrency"
```

### Task 6.2: Threshold/override resolution + exit-code helper

**Files:**
- Create: `src/pipeline/verdict.ts`
- Test: `tests/pipeline/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pipeline/verdict.test.ts
import { test, expect } from "bun:test";
import { resolveFailScore, passed, exitCodeFor } from "../../src/pipeline/verdict";
import type { ComparisonRecord } from "../../src/types";

const overrides = [{ path: "/blog/**", failScore: 0.05 }];

test("override applies to matching path, else global", () => {
  expect(resolveFailScore("/blog/x", 0.01, overrides)).toBe(0.05);
  expect(resolveFailScore("/pricing", 0.01, overrides)).toBe(0.01);
});

test("passed compares score to fail threshold", () => {
  expect(passed(0.005, 0.01)).toBe(true);
  expect(passed(0.02, 0.01)).toBe(false);
});

test("exit code: 0 all ok+pass, 1 on fail or error", () => {
  const ok: ComparisonRecord = { path: "/", viewport: 1, devUrl: "", prodUrl: "", status: "ok", passed: true };
  const fail: ComparisonRecord = { ...ok, passed: false };
  const err: ComparisonRecord = { path: "/", viewport: 1, devUrl: "", prodUrl: "", status: "error" };
  expect(exitCodeFor([ok])).toBe(0);
  expect(exitCodeFor([ok, fail])).toBe(1);
  expect(exitCodeFor([ok, err])).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pipeline/verdict.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pipeline/verdict.ts
import { matchPath } from "../glob";
import type { ComparisonRecord } from "../types";

export interface Override { path: string; failScore: number }

export function resolveFailScore(path: string, globalFailScore: number, overrides: Override[]): number {
  for (const o of overrides) if (matchPath(path, o.path)) return o.failScore;
  return globalFailScore;
}

export function passed(diffScore: number, failScore: number): boolean {
  return diffScore <= failScore;
}

/** 0 = all ok+passed; 1 = any diff-fail or error status (spec §7). The CLI sets
 * exit code 2 separately for operational errors that prevent a run. */
export function exitCodeFor(records: ComparisonRecord[]): number {
  for (const r of records) {
    if (r.status === "error") return 1;
    if (r.passed === false) return 1;
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pipeline/verdict.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/verdict.ts tests/pipeline/verdict.test.ts
git commit -m "feat: add threshold resolution and exit-code helper"
```

### Task 6.3: Pipeline run orchestration

**Files:**
- Create: `src/pipeline/run.ts`
- Test: `tests/pipeline/run.test.ts` (uses injected fakes, no real browser)

- [ ] **Step 1: Write the failing test**

```ts
// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline } from "../../src/pipeline/run";
import { openDb, readComparisons } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";

function png(w: number, h: number, v: number): Uint8Array {
  const p = new PNG({ width: w, height: h }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

test("pipeline captures, diffs, and persists for each path×viewport", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
    // Inject fakes for the browser-touching + discovery seams:
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: {
      submit: async (a: Uint8Array) =>
        ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a }),
      close: async () => {},
    },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2); // 2 paths × 1 viewport
  for (const r of rows) expect(r.status).toBe("ok");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/pipeline/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pipeline/run.ts
import type { Database } from "bun:sqlite";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult, ComparisonRecord } from "../types";
import type { DiffResponse } from "../diff/worker";
import { startRun, saveComparison, finishRun } from "../store/db";
import { mapWithConcurrency } from "./queue";
import { resolveFailScore, passed } from "./verdict";

export interface DiffPoolLike {
  submit(a: Uint8Array, b: Uint8Array, threshold: number): Promise<DiffResponse>;
  close(): Promise<void>;
}

export interface RunPipelineArgs {
  config: ResolvedConfig;
  db: Database;
  startedAt: string;
  finishedAt: string;
  discover: () => Promise<string[]>;
  captureFn: (url: string, viewport: number, cfg: ResolvedConfig) => Promise<CaptureResult>;
  diffPool: DiffPoolLike;
}

export async function runPipeline(args: RunPipelineArgs): Promise<void> {
  const { config, db } = args;
  const runId = startRun(db, {
    devBaseUrl: config.dev, prodBaseUrl: config.prod,
    configJson: JSON.stringify(config), startedAt: args.startedAt,
  });

  const paths = await args.discover();
  // Fan out into path × viewport jobs.
  const jobs = paths.flatMap((path) =>
    config.viewports.map((viewport) => ({ path, viewport })));

  await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
    const devUrl = new URL(job.path, config.dev).toString();
    const prodUrl = new URL(job.path, config.prod).toString();
    const rec: ComparisonRecord = {
      path: job.path, viewport: job.viewport, devUrl, prodUrl, status: "ok",
    };

    const [dev, prod] = await Promise.all([
      args.captureFn(devUrl, job.viewport, config),
      args.captureFn(prodUrl, job.viewport, config),
    ]);

    if (!dev.ok || !prod.ok) {
      rec.status = "error";
      rec.error = [dev.ok ? null : `dev: ${dev.error}`, prod.ok ? null : `prod: ${prod.error}`]
        .filter(Boolean).join("; ");
      saveComparison(db, runId, rec);
      return;
    }

    rec.devImage = dev.png; rec.prodImage = prod.png;
    const diff = await args.diffPool.submit(dev.png!, prod.png!, config.diff.threshold);
    if (!diff.ok) {
      rec.status = "error"; rec.error = `diff: ${diff.error}`;
      saveComparison(db, runId, rec);
      return;
    }
    rec.diffImage = diff.diffPng; rec.width = diff.width; rec.height = diff.height;
    rec.diffPixels = diff.diffPixels; rec.diffScore = diff.diffScore;
    const failScore = resolveFailScore(job.path, config.diff.failScore, config.diff.overrides);
    rec.passed = passed(diff.diffScore!, failScore);
    saveComparison(db, runId, rec);
  });

  finishRun(db, runId, "complete", args.finishedAt);
}
```

> **Timestamps:** `startedAt`/`finishedAt` are passed in by the caller so tests stay deterministic. The real CLI (`src/commands/run.ts`) supplies `new Date().toISOString()` for both — `Date` is fine in the CLI runtime.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/pipeline/run.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/run.ts tests/pipeline/run.test.ts
git commit -m "feat: add pipeline run orchestration"
```

---

## Chunk 7: Report, CLI, commands, build

**Purpose:** Render the self-contained HTML report (spec §3 stage 6), wire the CLI subcommands (spec §4), and produce the binary.

### Task 7.1: HTML report template (pure)

**Files:**
- Create: `src/report/template.ts`
- Test: `tests/report/template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/report/template.test.ts
import { test, expect } from "bun:test";
import { renderReport } from "../../src/report/template";
import type { ComparisonRecord } from "../../src/types";

const rows: ComparisonRecord[] = [
  { path: "/pricing", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1280, height: 2000, diffPixels: 500, diffScore: 0.2, passed: false, status: "ok" },
  { path: "/broken", viewport: 1280, devUrl: "d", prodUrl: "p", status: "error", error: "404 on dev" },
];

test("report contains pages, scores, and is self-contained", () => {
  const html = renderReport(rows, { dev: "https://dev", prod: "https://prod" });
  expect(html).toContain("/pricing");
  expect(html).toContain("/broken");
  expect(html).toContain("404 on dev");
  expect(html).toContain("data:image/png;base64,");
  // Self-contained: no external network references of any kind (spec §3 stage 6).
  expect(html).not.toMatch(/src=["']https?:/);        // no remote <img>/<script> src
  expect(html).not.toMatch(/<script\s+src=/i);         // no external scripts at all
  expect(html).not.toMatch(/<link\b[^>]*href=["']https?:/i); // no remote stylesheets
  expect(html).toContain("FAIL");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/report/template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/report/template.ts
import type { ComparisonRecord } from "../types";

function b64(bytes?: Uint8Array): string {
  if (!bytes) return "";
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function card(r: ComparisonRecord): string {
  if (r.status === "error") {
    return `<section class="card error">
      <h2>${esc(r.path)} <span class="vp">@${r.viewport}</span> <span class="badge err">ERROR</span></h2>
      <p class="msg">${esc(r.error ?? "unknown error")}</p></section>`;
  }
  const verdict = r.passed ? `<span class="badge pass">PASS</span>` : `<span class="badge fail">FAIL</span>`;
  const pct = ((r.diffScore ?? 0) * 100).toFixed(2);
  return `<section class="card">
    <h2>${esc(r.path)} <span class="vp">@${r.viewport}</span> ${verdict}
      <span class="score">${pct}% changed</span></h2>
    <div class="triptych">
      <figure><figcaption>dev</figcaption><img src="${b64(r.devImage)}" alt="dev"></figure>
      <figure><figcaption>prod</figcaption><img src="${b64(r.prodImage)}" alt="prod"></figure>
      <figure><figcaption>diff</figcaption><img src="${b64(r.diffImage)}" alt="diff"></figure>
    </div></section>`;
}

export function renderReport(
  records: ComparisonRecord[],
  meta: { dev: string; prod: string },
): string {
  // Worst-first: errors and highest diffScore at the top.
  const sorted = [...records].sort((a, b) => {
    const as = a.status === "error" ? Infinity : (a.diffScore ?? 0);
    const bs = b.status === "error" ? Infinity : (b.diffScore ?? 0);
    return bs - as;
  });
  const cards = sorted.map(card).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>momus report</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { padding: 1rem 1.5rem; background: #000; position: sticky; top: 0; }
  .card { padding: 1rem 1.5rem; border-bottom: 1px solid #333; }
  .triptych { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: .5rem; }
  figure { margin: 0; } img { max-width: 100%; border: 1px solid #444; background: #fff; }
  .badge { padding: .1rem .4rem; border-radius: .25rem; font-size: .75rem; }
  .pass { background: #164; } .fail { background: #a22; } .err { background: #953; }
  .vp { color: #888; } .score { color: #aaa; margin-left: .5rem; }
  .error .msg { color: #f99; }
</style></head><body>
<header><strong>momus</strong> — ${esc(meta.dev)} vs ${esc(meta.prod)} — ${sorted.length} comparisons</header>
<main>${cards}</main></body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/report/template.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/report/template.ts tests/report/template.test.ts
git commit -m "feat: add self-contained HTML report template"
```

### Task 7.2: Report writer

**Files:**
- Create: `src/report/report.ts`
- Test: `tests/report/report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/report/report.test.ts
import { test, expect } from "bun:test";
import { openDb, startRun, saveComparison, finishRun } from "../../src/store/db";
import { writeReport } from "../../src/report/report";

test("writeReport reads DB and writes an HTML file", async () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "https://dev", prodBaseUrl: "https://prod", configJson: "{}", startedAt: "t" });
  saveComparison(db, runId, {
    path: "/", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1, height: 1, diffPixels: 0, diffScore: 0, passed: true, status: "ok",
  });
  finishRun(db, runId, "complete", "t2");

  const out = `${import.meta.dir}/.tmp-report.html`;
  await writeReport(db, runId, out);
  const html = await Bun.file(out).text();
  expect(html).toContain("<title>momus report</title>");
  await Bun.file(out).delete();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/report/report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/report/report.ts
import type { Database } from "bun:sqlite";
import { readComparisons } from "../store/db";
import { renderReport } from "./template";

export async function writeReport(db: Database, runId: number, outPath: string): Promise<void> {
  const rows = readComparisons(db, runId);
  const run = db.query(`SELECT dev_base_url, prod_base_url FROM runs WHERE id = ?`).get(runId) as any;
  const html = renderReport(rows, { dev: run?.dev_base_url ?? "", prod: run?.prod_base_url ?? "" });
  await Bun.write(outPath, html); // overwrites (spec §6)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/report/report.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/report/report.ts tests/report/report.test.ts
git commit -m "feat: add report writer"
```

### Task 7.3: `init` command (scaffold config)

**Files:**
- Create: `src/commands/init.ts`
- Test: `tests/commands/init.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/init.test.ts
import { test, expect } from "bun:test";
import { configScaffold } from "../../src/commands/init";

test("scaffold is valid TS exporting a defineConfig call", () => {
  const s = configScaffold();
  expect(s).toContain("defineConfig");
  expect(s).toContain("dev:");
  expect(s).toContain("prod:");
  expect(s).toContain("viewports");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commands/init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/init.ts

export function configScaffold(): string {
  return `import { defineConfig } from "momus";

export default defineConfig({
  dev: "https://dev.example.com",
  prod: "https://www.example.com",

  discovery: {
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 3, maxPages: 500 },
    include: ["/**"],
    exclude: ["/admin/**"],
  },

  viewports: [375, 768, 1280],

  stabilize: {
    waitUntil: "networkidle",
    settleMs: 500,
    timeoutMs: 15000,
    disableAnimations: true,
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],
  },

  diff: {
    threshold: 0.1,
    failScore: 0.01,
    overrides: [{ path: "/blog/**", failScore: 0.05 }],
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite" },
});
`;
}

export async function runInit(cwd: string): Promise<string> {
  const path = `${cwd}/momus.config.ts`;
  if (await Bun.file(path).exists()) throw new Error(`${path} already exists`);
  await Bun.write(path, configScaffold());
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/commands/init.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts tests/commands/init.test.ts
git commit -m "feat: add init command config scaffold"
```

### Task 7.4: CLI entry (arg parsing + subcommand dispatch)

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Write the failing test (arg parsing only — pure)**

```ts
// tests/cli.test.ts
import { test, expect } from "bun:test";
import { parseCliArgs } from "../src/cli";

test("parses run subcommand with overrides", () => {
  const p = parseCliArgs(["run", "--dev", "https://d.com", "--concurrency", "8", "--crawl"]);
  expect(p.command).toBe("run");
  expect(p.overrides.dev).toBe("https://d.com");
  expect(p.overrides.concurrency).toBe(8);
  expect(p.overrides.crawl).toBe(true);
});

test("parses init and install-browser", () => {
  expect(parseCliArgs(["init"]).command).toBe("init");
  expect(parseCliArgs(["install-browser"]).command).toBe("install-browser");
});

test("unknown command yields help", () => {
  expect(parseCliArgs([]).command).toBe("help");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli.ts
import { parseArgs } from "node:util";
import type { CliOverrides } from "./config/load";

export interface ParsedCli {
  command: "run" | "init" | "install-browser" | "help";
  overrides: CliOverrides;
  configPath?: string;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const command = (argv[0] ?? "help") as ParsedCli["command"];
  const known = new Set(["run", "init", "install-browser"]);
  if (!known.has(command)) return { command: "help", overrides: {} };

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      dev: { type: "string" },
      prod: { type: "string" },
      out: { type: "string" },
      config: { type: "string" },
      concurrency: { type: "string" },
      crawl: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const overrides: CliOverrides = {};
  if (values.dev) overrides.dev = values.dev as string;
  if (values.prod) overrides.prod = values.prod as string;
  if (values.out) overrides.out = values.out as string;
  if (values.concurrency) overrides.concurrency = Number(values.concurrency);
  if (values.crawl) overrides.crawl = true;

  return { command, overrides, configPath: values.config as string | undefined };
}

// --- Runtime dispatch (integration test covers it, not unit tests) ---
async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "init": {
      const { runInit } = await import("./commands/init");
      const path = await runInit(process.cwd());
      console.log(`Created ${path}`);
      return;
    }
    case "install-browser": {
      const { installBrowser } = await import("./commands/install");
      process.exit(await installBrowser());
    }
    case "run": {
      const { runCommand } = await import("./commands/run");
      process.exit(await runCommand(parsed));
    }
    default:
      console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--crawl]`);
      process.exit(0);
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add CLI arg parsing and subcommand dispatch"
```

### Task 7.4a: `install-browser` command (the only downloader)

**Files:**
- Create: `src/commands/install.ts`

> **Why this is not `Bun.spawn(["bunx", "playwright", ...])`:** the deliverable is a distributed single binary (spec §1). A clean host / CI runner is not guaranteed to have `bunx` or the `playwright` npm package on PATH, yet `install-browser` is the *only* sanctioned way to get Chromium (spec §7). So it must download **in-process** using the Playwright code already bundled into the binary, and fall back to a clear instruction if that fails.
>
> **Spike dependency:** the exact in-process install call is confirmed during the Chunk 0 compile spike (Task 0.4). If the pinned Playwright version exposes a different install entry point, pin the working call here when you do the spike. If the spike forced a switch to `puppeteer-core`, reimplement `installBrowser()` against `@puppeteer/browsers` instead, keeping the same `installBrowser(): Promise<number>` signature.

- [ ] **Step 1: Write the implementation**

```ts
// src/commands/install.ts
// Downloads the pinned Chromium. Runs Playwright's installer in-process so a
// distributed binary needs no external `bunx`/npm. Exact entry point validated
// in the Chunk 0 spike (Task 0.4); adjust here if the pinned version differs.
export async function installBrowser(): Promise<number> {
  try {
    // playwright-core bundles a CLI "program" (commander) that registers the
    // `install` command on import. Invoking it in-process avoids relying on a
    // globally-installed `playwright` or `bunx`.
    // @ts-ignore — deep internal subpath; not in playwright-core's type exports.
    // Pin the exact path in the Chunk 0 spike; a resolution failure here is
    // caught below and degrades to the manual-install fallback.
    const mod: any = await import("playwright-core/lib/cli/program");
    const program = mod.program ?? mod.default;
    if (program && typeof program.parseAsync === "function") {
      // Note: commander's parseAsync may call process.exit() itself on
      // completion/error, in which case control never returns here — the exit
      // code is still correct. The explicit return covers the non-exiting path.
      await program.parseAsync(["node", "playwright", "install", "chromium"]);
      return 0;
    }
    throw new Error("playwright CLI program not found at expected path");
  } catch (err) {
    console.error(
      "Could not install Chromium in-process.\n" +
      "Install it once manually (use the same PLAYWRIGHT_BROWSERS_PATH momus uses, if set):\n" +
      "  npx playwright install chromium\n" +
      `Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }
}
```

- [ ] **Step 2: Smoke-test the command resolves and returns a number**

Run: `bun run src/cli.ts install-browser`
Expected: either downloads Chromium and exits 0, or prints the manual-install fallback and exits 2 — never an unhandled crash. (If Chromium is already installed, Playwright's installer is a fast no-op.)

- [ ] **Step 3: Commit**

```bash
git add src/commands/install.ts
git commit -m "feat: add in-process install-browser command"
```

### Task 7.5: `run` command (wires config → discovery → pipeline → report)

**Files:**
- Create: `src/commands/run.ts`

> This module is the real wiring exercised by the Chunk 8 end-to-end test; it has no unit test of its own (its parts are all tested). Keep it thin.

- [ ] **Step 1: Write the implementation**

```ts
// src/commands/run.ts
import type { ParsedCli } from "../cli";
import { loadConfigFile, resolveConfig } from "../config/load";
import { isBrowserInstalled, launchBrowser } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { discoverPaths } from "../discovery/discover";
import { DiffPool } from "../diff/pool";
import { openDb, readComparisons } from "../store/db";
import { runPipeline } from "../pipeline/run";
import { exitCodeFor } from "../pipeline/verdict";
import { writeReport } from "../report/report";
import type { ResolvedConfig } from "../config/schema";
import type { CaptureResult } from "../types";

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

  // Single-run mode: start from a truly fresh DB file (spec §5/§7), removing any
  // stale WAL/SHM sidecars from a prior run.
  for (const suffix of ["", "-wal", "-shm"]) {
    try { await Bun.file(config.output.db + suffix).delete(); } catch { /* absent */ }
  }
  const db = openDb(config.output.db);
  const browser = await launchBrowser();
  const diffPool = new DiffPool(config.concurrency.diffWorkers);

  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };

  const now = new Date().toISOString();
  try {
    await runPipeline({
      config, db, startedAt: now, finishedAt: new Date().toISOString(),
      discover: () => discoverPaths({
        base: config.prod,
        sitemap: config.discovery.sitemap,
        crawl: { enabled: config.discovery.crawl.enabled, startPath: config.discovery.crawl.startPath,
                 maxDepth: config.discovery.crawl.maxDepth, maxPages: config.discovery.crawl.maxPages },
        include: config.discovery.include, exclude: config.discovery.exclude,
        fetcher: realFetch,
      }),
      captureFn: (url: string, vw: number, cfg: ResolvedConfig): Promise<CaptureResult> =>
        capture(browser, url, vw, cfg.stabilize),
      diffPool,
    });
  } catch (err) {
    console.error(`Run failed: ${err instanceof Error ? err.message : err}`);
    await diffPool.close();
    await browser.close();
    return 2;
  }
  await diffPool.close();
  await browser.close();

  await writeReport(db, 1, config.output.report);
  const rows = readComparisons(db, 1);
  const code = exitCodeFor(rows);
  console.log(`Wrote ${config.output.report} (${rows.length} comparisons). Exit ${code}.`);
  return code;
}
```

- [ ] **Step 2: Type-check the whole project**

Run: `bunx tsc --noEmit`
Expected: no type errors. This is the real safety net for `run.ts` — the only wiring module without a unit test — so a signature mismatch here is caught before the browser-gated e2e test (which skips when Chromium is absent).

- [ ] **Step 3: Commit**

```bash
git add src/commands/run.ts
git commit -m "feat: add run command wiring"
```

### Task 7.6: Build script (single binary)

**Files:**
- Create: `build.ts`

- [ ] **Step 1: Write the build script**

```ts
// build.ts
// Compiles momus to a single binary. Playwright browser remains external
// (installed via `momus install-browser`), per spec §1/§7.
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: { outfile: "momus" },
  target: "bun",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Built ./momus");
```

- [ ] **Step 2: Build the binary**

Run: `bun run build.ts`
Expected: prints `Built ./momus` and creates an executable `momus`. (If the `Bun.build` compile option differs in the installed Bun version, fall back to the CLI form: `bun build src/cli.ts --compile --outfile momus`, and change the `build` npm script accordingly.)

- [ ] **Step 3: Smoke-test the binary's help**

Run: `./momus`
Expected: prints usage text and exits 0.

- [ ] **Step 4: Smoke-test init via the binary**

Run: `mkdir -p /tmp/momus-smoke && ( cd /tmp/momus-smoke && /home/bjhale/projects/momus/momus init ) && head -1 /tmp/momus-smoke/momus.config.ts && rm -rf /tmp/momus-smoke`
Expected: prints "Created …/momus.config.ts" and the file's first line is the import statement.

- [ ] **Step 5: Commit**

```bash
git add build.ts
git commit -m "feat: add single-binary build script"
```

---

## Chunk 8: End-to-end integration & polish

**Purpose:** Prove the whole pipeline works against two real local sites, headless (spec §8 integration test).

### Task 8.1: End-to-end integration test

**Files:**
- Create: `tests/e2e/pipeline.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/e2e/pipeline.integration.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { capture } from "../../src/capture/screenshot";
import { DiffPool } from "../../src/diff/pool";
import { openDb, readComparisons } from "../../src/store/db";
import { runPipeline } from "../../src/pipeline/run";
import { ConfigSchema } from "../../src/config/schema";

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

maybe("dev vs prod: unchanged page passes, changed page fails", async () => {
  const dev = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:red'><h1>About CHANGED</h1></body></html>",
  });
  const prod = serve({
    "/": "<html><body><h1 style='color:black'>Home</h1></body></html>",
    "/about": "<html><body style='background:white'><h1>About</h1></body></html>",
  });

  const config = ConfigSchema.parse({
    dev: `http://localhost:${dev.port}`,
    prod: `http://localhost:${prod.port}`,
    viewports: [1280],
    stabilize: { waitUntil: "load", settleMs: 0 },
  });

  const db = openDb(":memory:");
  const browser = await launchBrowser();
  const pool = new DiffPool(2);
  try {
    await runPipeline({
      config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
      discover: async () => ["/", "/about"],
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize),
      diffPool: pool,
    });
  } finally {
    await pool.close(); await browser.close(); dev.stop(); prod.stop();
  }

  const rows = readComparisons(db, 1);
  const home = rows.find((r) => r.path === "/")!;
  const about = rows.find((r) => r.path === "/about")!;
  expect(home.status).toBe("ok");
  expect(home.passed).toBe(true);            // identical → passes
  expect(about.passed).toBe(false);          // changed background+text → fails
  expect(about.diffScore!).toBeGreaterThan(home.diffScore!);
});
```

- [ ] **Step 2: Run test to verify it fails (or skips without a browser)**

Run: `bunx playwright install chromium && bun test tests/e2e/pipeline.integration.test.ts`
Expected: with all prior chunks complete it should PASS. If it SKIPs, the browser isn't installed — install it and re-run.

- [ ] **Step 3: Fix any wiring issues surfaced**

If the test fails, use superpowers:systematic-debugging. Common issues: viewport height defaults, `waitUntil` timing, or padding when the two pages differ in height.

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: all unit tests pass; integration tests pass (browser installed) or skip cleanly.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pipeline.integration.test.ts
git commit -m "test: add end-to-end pipeline integration test"
```

### Task 8.2: Real-binary end-to-end smoke (manual verification)

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the binary**

Run: `bun run build.ts`
Expected: `Built ./momus`.

- [ ] **Step 2: Create two throwaway local sites and a config**

Serve two static directories that differ on one page (e.g. `python3 -m http.server` in two folders, or two `Bun.serve` scripts). Run `./momus init` and edit `dev`/`prod` in `momus.config.ts` to point at them; set `discovery.sitemap` false and `discovery.crawl.enabled` true (or add a sitemap) so discovery finds pages.

> **Config-import note:** the scaffolded `momus.config.ts` starts with `import { defineConfig } from "momus"`. That bare specifier only resolves if this dir has `momus` on its module path (run the smoke inside the repo, or `bun link momus` first). For a standalone throwaway dir, either `bun link` momus or replace the first line with a plain typed object (drop the `defineConfig` import) — `loadConfigFile` validates via Zod regardless, so `defineConfig` is only for editor types.

- [ ] **Step 3: Run the binary end-to-end**

Run: `./momus run --config ./momus.config.ts`
Expected: prints "Wrote momus-report.html (N comparisons). Exit C." and produces `momus-report.html`.

- [ ] **Step 4: Open the report and eyeball it**

Open `momus-report.html` in a browser. Confirm dev|prod|diff triptychs render, scores show, and worst-first ordering holds. Use the verify skill if available.

- [ ] **Step 5: README + final commit**

Create a short `README.md` documenting: install, `momus install-browser`, `momus init`, `momus run`, and the exit codes (0 all-pass, 1 any fail/error, 2 ops error). Commit:

```bash
git add README.md
git commit -m "docs: add README with usage and exit codes"
```

---

## Done criteria

- `bun test` green (unit always; integration when a browser is installed).
- `bun run build.ts` produces a working `./momus` binary.
- `./momus run` against two sites yields a self-contained `momus-report.html` and a correct exit code (0 all-pass, 1 any fail/error, 2 ops error).
- Every task committed; no TODOs left in `src/`.
```
