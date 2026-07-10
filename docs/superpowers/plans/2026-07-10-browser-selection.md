# Browser Engine Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick which Playwright engine momus drives — `chromium` (default), `firefox`, or `webkit` — via a config field and `--browser` CLI override, with the choice gated against the prod baseline.

**Architecture:** A new `browser` enum on the Zod config schema flows through CLI overrides into `ResolvedConfig`. `src/capture/browser.ts` maps the engine name to a Playwright `BrowserType`. The engine is persisted in the snapshot row and checked in `baselineConflict` so a run cannot silently diff across engines. `install-browser` and the Docker image provide all three engines.

**Tech Stack:** Bun, TypeScript, Zod, Playwright / playwright-core, bun:sqlite, `bun test`.

## Global Constraints

- Engine values are exactly `"chromium" | "firefox" | "webkit"`. Default is `"chromium"`. Verbatim, everywhere (schema enum, `BrowserEngine` type, docs).
- Google Chrome branded channel (`channel: "chrome"`) is **out of scope**.
- Backward compatibility: an existing baseline DB with no stored browser must read back as `"chromium"` and stay diffable against a default-config run.
- CLI overrides win over config-file values (existing convention).
- Follow TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit.
- Run tests with `bun test`. Run a specific file with `bun test <path>`.

---

### Task 1: Config schema `browser` field + init scaffold

**Files:**
- Modify: `src/config/schema.ts` (add `browser` to `ConfigSchema`)
- Modify: `src/commands/init.ts` (scaffold comment line)
- Test: `tests/config/schema.test.ts`

**Interfaces:**
- Produces: `ConfigSchema` gains `browser: "chromium" | "firefox" | "webkit"` (default `"chromium"`); `ResolvedConfig["browser"]` is that union.

- [ ] **Step 1: Write the failing tests**

Add to `tests/config/schema.test.ts`:

```ts
test("browser defaults to chromium", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.browser).toBe("chromium");
});

test("browser accepts firefox and webkit", () => {
  expect(ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "firefox" }).browser).toBe("firefox");
  expect(ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "webkit" }).browser).toBe("webkit");
});

test("browser rejects an unknown engine", () => {
  expect(() => ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "safari" })).toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/config/schema.test.ts`
Expected: FAIL — `c.browser` is `undefined`; the `"safari"` case does not throw.

- [ ] **Step 3: Add the schema field**

In `src/config/schema.ts`, inside the `z.object({ ... })`, add this line immediately after the `requestHeaders` line:

```ts
  browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
```

- [ ] **Step 4: Update the init scaffold**

In `src/commands/init.ts`, in the template string returned by `configScaffold()`, add a line right after the `prod:` line (before the `insecure` comment):

```ts
  browser: "chromium",   // "chromium" | "firefox" | "webkit"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/config/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/commands/init.ts tests/config/schema.test.ts
git commit -m "feat: add browser engine config field (chromium|firefox|webkit)"
```

---

### Task 2: `--browser` CLI flag + override plumbing

**Files:**
- Modify: `src/cli.ts` (parseArgs option, override mapping, help text)
- Modify: `src/config/load.ts` (`CliOverrides.browser`, merge in `resolveConfig`)
- Test: `tests/config/load.test.ts`, `tests/cli.test.ts`

**Interfaces:**
- Consumes: `ConfigSchema` with `browser` enum (Task 1).
- Produces: `CliOverrides` gains `browser?: string`; `ParsedCli.overrides.browser` set from `--browser`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/config/load.test.ts`:

```ts
test("--browser overrides the config-file browser value", () => {
  const c = resolveConfig({ ...base, browser: "chromium" }, { browser: "firefox" });
  expect(c.browser).toBe("firefox");
});

test("browser falls back to the file value when no override", () => {
  const c = resolveConfig({ ...base, browser: "webkit" }, {});
  expect(c.browser).toBe("webkit");
});
```

Add to `tests/cli.test.ts` (match the file's existing import/test style):

```ts
test("--browser flag is parsed into overrides", () => {
  const parsed = parseCliArgs(["run", "--browser", "webkit"]);
  expect(parsed.overrides.browser).toBe("webkit");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/config/load.test.ts tests/cli.test.ts`
Expected: FAIL — `resolveConfig` ignores `cli.browser`; `parsed.overrides.browser` is `undefined`.

- [ ] **Step 3: Add `browser` to `CliOverrides` and merge it**

In `src/config/load.ts`, add to the `CliOverrides` interface:

```ts
  browser?: string;
```

In `resolveConfig`, add this line right before `if (cli.insecure !== undefined)`:

```ts
  if (cli.browser !== undefined) merged.browser = cli.browser as RawConfig["browser"];
```

- [ ] **Step 4: Add the CLI flag and mapping**

In `src/cli.ts`, add to the `options` object in `parseArgs` (after `insecure`):

```ts
      browser: { type: "string" },
```

In `parseCliArgs`, add right after the `insecure` mapping:

```ts
  if (values.browser) overrides.browser = values.browser as string;
```

Update the two help usage lines in the `default:` case so each shows `[--browser NAME]`:

```ts
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus snapshot [--prod URL] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure] [--browser NAME]\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure] [--browser NAME]`);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/config/load.test.ts tests/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/config/load.ts tests/config/load.test.ts tests/cli.test.ts
git commit -m "feat: add --browser CLI flag wired through resolveConfig"
```

---

### Task 3: Engine selection in `src/capture/browser.ts`

**Files:**
- Modify: `src/capture/browser.ts`
- Test: `tests/capture/browser.test.ts`

**Interfaces:**
- Produces:
  - `export type BrowserEngine = "chromium" | "firefox" | "webkit";`
  - `isBrowserInstalled(engine?: BrowserEngine): boolean` (defaults to `"chromium"`)
  - `launchBrowser(engine?: BrowserEngine): Promise<Browser>` (defaults to `"chromium"`)
  - `newContext` signature is unchanged.
  - `export const ENGINES: Record<BrowserEngine, BrowserType>` (exported so tests can spy on it).

- [ ] **Step 1: Write the failing tests**

Add to `tests/capture/browser.test.ts`:

```ts
import { launchBrowser, ENGINES } from "../../src/capture/browser";
import { spyOn } from "bun:test";

test("launchBrowser selects the requested engine", async () => {
  const fakeBrowser = {} as any;
  const spy = spyOn(ENGINES.firefox, "launch").mockResolvedValue(fakeBrowser);
  const b = await launchBrowser("firefox");
  expect(b).toBe(fakeBrowser);
  expect(spy).toHaveBeenCalledWith({ headless: true });
  spy.mockRestore();
});

test("launchBrowser defaults to chromium", async () => {
  const fakeBrowser = {} as any;
  const spy = spyOn(ENGINES.chromium, "launch").mockResolvedValue(fakeBrowser);
  await launchBrowser();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

test("isBrowserInstalled checks the requested engine's path", () => {
  const spy = spyOn(ENGINES.webkit, "executablePath").mockReturnValue("");
  expect(isBrowserInstalled("webkit")).toBe(false);
  spy.mockRestore();
});
```

Note: the existing `import { isBrowserInstalled, newContext }` line stays; add `launchBrowser, ENGINES` to it or to a new import line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/capture/browser.test.ts`
Expected: FAIL — `ENGINES` and the engine argument to `launchBrowser` do not exist yet.

- [ ] **Step 3: Rewrite `src/capture/browser.ts`**

Replace the file contents with:

```ts
// src/capture/browser.ts
// Drive a Playwright engine via `playwright-core`: `launch({ headless: true })`
// resolves the browser from $PLAYWRIGHT_BROWSERS_PATH or the default Playwright
// cache, and `<engine>.executablePath()` returns that path (used for the
// presence check).
import { chromium, firefox, webkit, type BrowserType, type Browser, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";

export type BrowserEngine = "chromium" | "firefox" | "webkit";

/** Exported so tests can spy on a specific engine's launch/executablePath. */
export const ENGINES: Record<BrowserEngine, BrowserType> = { chromium, firefox, webkit };

/** True if the pinned executable for the given engine exists on disk. */
export function isBrowserInstalled(engine: BrowserEngine = "chromium"): boolean {
  try {
    const p = ENGINES[engine].executablePath();
    return typeof p === "string" && p.length > 0 && existsSync(p);
  } catch {
    return false;
  }
}

export async function launchBrowser(engine: BrowserEngine = "chromium"): Promise<Browser> {
  return ENGINES[engine].launch({ headless: true });
}

export async function newContext(
  browser: Browser, viewportWidth: number, ignoreHTTPSErrors = false,
  extraHTTPHeaders?: Record<string, string>,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors,
    ...(extraHTTPHeaders && Object.keys(extraHTTPHeaders).length > 0 && { extraHTTPHeaders }),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/capture/browser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/capture/browser.ts tests/capture/browser.test.ts
git commit -m "feat: select playwright engine in launchBrowser/isBrowserInstalled"
```

---

### Task 4: Wire the engine through the `run` and `snapshot` commands

**Files:**
- Modify: `src/commands/run.ts`
- Modify: `src/commands/snapshot.ts`

**Interfaces:**
- Consumes: `isBrowserInstalled(engine)`, `launchBrowser(engine)` (Task 3); `config.browser` (Task 1).

Config must be resolved **before** the browser presence check so the check knows which engine to look for. Both commands currently check the browser first — reorder them.

- [ ] **Step 1: Reorder + engine-select in `src/commands/run.ts`**

Delete the leading presence-check block (lines that read):

```ts
  if (!isBrowserInstalled()) {
    console.error("No browser found. Run `momus install-browser` first.");
    return 2;
  }
```

Then, immediately **after** the `config = resolveConfig(raw, parsed.overrides);` block's closing `}` (i.e. after config is successfully resolved), insert:

```ts
  if (!isBrowserInstalled(config.browser)) {
    console.error(`No ${config.browser} browser found. Run \`momus install-browser\` first.`);
    return 2;
  }
```

Change the launch line from `const browser = await launchBrowser();` to:

```ts
  const browser = await launchBrowser(config.browser);
```

- [ ] **Step 2: Reorder + engine-select in `src/commands/snapshot.ts`**

Apply the identical transformation: remove the top `if (!isBrowserInstalled())` block, add the `if (!isBrowserInstalled(config.browser))` check right after config is resolved, and change `await launchBrowser()` to `await launchBrowser(config.browser)`.

- [ ] **Step 3: Typecheck + run the full suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS — no type errors; existing unit tests green (browser-dependent integration tests skip when no browser is installed).

- [ ] **Step 4: Commit**

```bash
git add src/commands/run.ts src/commands/snapshot.ts
git commit -m "feat: drive the configured engine in run and snapshot commands"
```

---

### Task 5: Persist the engine in the baseline + gate on it

**Files:**
- Modify: `src/store/db.ts` (`snapshot` DDL, idempotent `ALTER`, `SnapshotMeta`, `writeSnapshot`, `readSnapshot`)
- Modify: `src/pipeline/snapshot.ts` (include `browser` in the written meta)
- Modify: `src/pipeline/compat.ts` (`baselineConflict` browser check)
- Test: `tests/store/db.test.ts`, `tests/pipeline/compat.test.ts`

**Interfaces:**
- Consumes: `BrowserEngine` (Task 3), `config.browser` (Task 1).
- Produces: `SnapshotMeta` gains optional `browser?: BrowserEngine`; `readSnapshot` always returns a defined `browser` (defaulting to `"chromium"`); `baselineConflict` returns a `browser differs: …` reason on mismatch.

`browser?` is **optional** on `SnapshotMeta` so existing test literals and callers that omit it still compile; `writeSnapshot` defaults it to `"chromium"`, and `readSnapshot` defaults a null column to `"chromium"`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/store/db.test.ts`:

```ts
test("writeSnapshot then readSnapshot round-trips the browser", () => {
  const db = openDb(":memory:");
  writeSnapshot(db, { createdAt: "a", prodBaseUrl: "https://one.com", viewports: [1], stabilize: STAB, configJson: "{}", browser: "firefox" });
  expect(readSnapshot(db)!.browser).toBe("firefox");
});

test("readSnapshot defaults browser to chromium when the column is null", () => {
  const db = openDb(":memory:");
  // Simulate an old snapshot row written before the browser column existed.
  db.query(
    `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json)
     VALUES (1, 'a', 'https://one.com', '[1]', '{}', '{}')`,
  ).run();
  expect(readSnapshot(db)!.browser).toBe("chromium");
});
```

Add to `tests/pipeline/compat.test.ts` (note: extend `snapFrom` to carry the config's browser):

```ts
test("differing browser → conflict mentioning browser", () => {
  const c = cfg({ browser: "firefox" });
  const snap = snapFrom(cfg({ browser: "chromium" }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("browser");
});

test("matching browser → no browser conflict", () => {
  const c = cfg({ browser: "webkit" });
  expect(baselineConflict(c, snapFrom(c))).toBeNull();
});
```

Update the existing `snapFrom` helper in `tests/pipeline/compat.test.ts` to pass the browser through:

```ts
function snapFrom(c: ReturnType<typeof cfg>): SnapshotMeta {
  return { createdAt: "t", prodBaseUrl: c.prod, viewports: c.viewports, stabilize: c.stabilize, configJson: "{}", browser: c.browser };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/store/db.test.ts tests/pipeline/compat.test.ts`
Expected: FAIL — `SnapshotMeta` has no `browser`; `readSnapshot` returns `undefined` for it; `baselineConflict` ignores it.

- [ ] **Step 3: Add the column, migration, and meta round-trip in `src/store/db.ts`**

In the `SCHEMA` string, add a `browser` column to the `snapshot` table so fresh DBs have it:

```ts
CREATE TABLE IF NOT EXISTS snapshot (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL,
  prod_base_url  TEXT NOT NULL,
  viewports_json TEXT NOT NULL,
  stabilize_json TEXT NOT NULL,
  config_json    TEXT NOT NULL,
  browser        TEXT
);
```

In `openDb`, after `db.exec(SCHEMA);` and before `return db;`, add an idempotent migration for pre-existing DBs whose `snapshot` table lacks the column:

```ts
  // Migrate older DBs: add the snapshot.browser column if it is missing.
  const cols = db.query("PRAGMA table_info(snapshot)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "browser")) {
    db.exec("ALTER TABLE snapshot ADD COLUMN browser TEXT;");
  }
```

Import the engine type at the top of `src/store/db.ts`:

```ts
import type { BrowserEngine } from "../capture/browser";
```

Add `browser` to the `SnapshotMeta` interface (optional):

```ts
export interface SnapshotMeta {
  createdAt: string;
  prodBaseUrl: string;
  viewports: number[];
  stabilize: StabilizeOptions;
  configJson: string;
  browser?: BrowserEngine;
}
```

Update `writeSnapshot` to persist it (defaulting when absent):

```ts
export function writeSnapshot(db: Database, m: SnapshotMeta): void {
  db.exec("DELETE FROM snapshot;");
  db.query(
    `INSERT INTO snapshot (id, created_at, prod_base_url, viewports_json, stabilize_json, config_json, browser)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(m.createdAt, m.prodBaseUrl, JSON.stringify(m.viewports), JSON.stringify(m.stabilize), m.configJson, m.browser ?? "chromium");
}
```

Update `readSnapshot` to return it (defaulting a null column):

```ts
export function readSnapshot(db: Database): SnapshotMeta | null {
  const row = db.query("SELECT * FROM snapshot WHERE id = 1").get() as any;
  if (!row) return null;
  return {
    createdAt: row.created_at,
    prodBaseUrl: row.prod_base_url,
    viewports: JSON.parse(row.viewports_json),
    stabilize: JSON.parse(row.stabilize_json),
    configJson: row.config_json,
    browser: (row.browser ?? "chromium") as BrowserEngine,
  };
}
```

- [ ] **Step 4: Write the engine when materializing a baseline**

In `src/pipeline/snapshot.ts`, in the `writeSnapshot(db, { ... })` call, add:

```ts
    browser: config.browser,
```

- [ ] **Step 5: Add the gate in `src/pipeline/compat.ts`**

In `baselineConflict`, add this check at the top of the function body (before the viewports check):

```ts
  if (config.browser !== (snapshot.browser ?? "chromium")) {
    return `browser differs: config "${config.browser}" vs baseline "${snapshot.browser ?? "chromium"}"`;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/store/db.test.ts tests/pipeline/compat.test.ts`
Expected: PASS

- [ ] **Step 7: Full suite + typecheck**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/store/db.ts src/pipeline/snapshot.ts src/pipeline/compat.ts tests/store/db.test.ts tests/pipeline/compat.test.ts
git commit -m "feat: persist and gate the browser engine in the prod baseline"
```

---

### Task 6: Install all three engines + Docker + README

**Files:**
- Modify: `src/commands/install.ts`
- Modify: `Dockerfile`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new; this task provisions the engines the earlier tasks can select.

- [ ] **Step 1: Install all three engines in `src/commands/install.ts`**

Change the installer invocation from:

```ts
      await program.parseAsync(["node", "playwright", "install", "chromium"]);
```

to:

```ts
      await program.parseAsync(["node", "playwright", "install", "chromium", "firefox", "webkit"]);
```

Update the fallback help text: change the top comment (line ~2) to reference all three engines, change the `momus could not download Chromium.` line to `momus could not download the browser engines.`, and change the `npx playwright install chromium` hint line to:

```ts
        "  npx playwright install chromium firefox webkit",
```

- [ ] **Step 2: Bake all three engines into the Docker image**

In `Dockerfile`, after the `RUN bun install --frozen-lockfile` line, add a step that downloads the two engines not already in the base image (Chromium ships in the base image):

```dockerfile
# The Playwright base image ships Chromium only. Add Firefox and WebKit so the
# `browser` config can select any engine. They install into the base image's
# PLAYWRIGHT_BROWSERS_PATH; the base image already carries the OS deps for this
# Playwright version.
RUN bunx playwright install firefox webkit
```

Also update the comment block near the top of the `Dockerfile` (lines ~10-12) that currently says the base image ships "Chromium" — note it now also carries Firefox and WebKit added at build time.

- [ ] **Step 3: Update the README**

Make these edits in `README.md`:

- Intro/Install section (around lines 16-20): change "with the Chromium browser and all its system libraries baked in" and "Chromium included" to reflect that all three engines (Chromium, Firefox, WebKit) are included.
- `install-browser` command description (line ~78): change "Downloads the Chromium build momus captures with." to "Downloads the browser engines momus captures with (Chromium, Firefox, WebKit)."
- From-source steps (line ~39): update the comment "download the Chromium momus drives" to "download the browser engines momus drives".
- Configuration section: document the new field. Add to the `defineConfig` example (right after the `insecure:` line):

  ```ts
  browser: "chromium",              // engine: "chromium" | "firefox" | "webkit"
  ```

  And add a bullet to the Notes list:

  > - **`browser`** selects the Playwright engine used for every capture:
  >   `"chromium"` (default), `"firefox"`, or `"webkit"`. Override per run with
  >   `--browser NAME`. The engine is recorded in the prod baseline; a `momus run`
  >   whose `browser` differs from the baseline's fails fast (exit 2), because
  >   screenshots from different engines are not comparable. Re-capture with
  >   `momus snapshot` to change the baseline's engine.

- Add `--browser NAME` to the `snapshot` and `run` flag tables (a row: `| \`--browser NAME\` | Engine to capture with (\`chromium\`\|\`firefox\`\|\`webkit\`); overrides \`browser\`. |`).

- [ ] **Step 4: Verify the build and suite**

Run: `bunx tsc --noEmit && bun test`
Expected: PASS

Optionally (if Docker is available): `docker build -t momus-dev .` succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/commands/install.ts Dockerfile README.md
git commit -m "feat: install all three engines, bake into image, document browser field"
```

---

## Self-Review

**Spec coverage:**
- §1 Configuration & Schema → Task 1. ✓
- §2 CLI Flag & Override Plumbing → Task 2. ✓
- §3 Browser Launch → Task 3 (browser.ts) + Task 4 (command wiring/reorder). ✓
- §4 Baseline Compatibility Gate → Task 5 (db persistence + migration + compat check). ✓
- §5 Installation & Docker → Task 6. ✓
- §6 Testing → tests live in Tasks 1-5; Task 6 verifies the full suite. ✓
- Backward-compat default (`"chromium"` for old baselines) → Task 5 Steps 3 (read default + migration) and its dedicated test. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows the exact code. ✓

**Type consistency:** `BrowserEngine` defined and exported in Task 3 (`src/capture/browser.ts`); imported by `src/store/db.ts` in Task 5. Enum values `"chromium" | "firefox" | "webkit"` identical across schema (Task 1), type (Task 3), and DDL default (Task 5). `SnapshotMeta.browser` is optional and defaulted in both `writeSnapshot` and `readSnapshot`, keeping existing literals valid. `config.browser` (Task 1) consumed by commands (Task 4), snapshot pipeline (Task 5 Step 4), and compat (Task 5 Step 5). `ENGINES` exported for test spies (Task 3) and used by tests. ✓
