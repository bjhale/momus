# Browser Engine Selection — Design

## Overview

Let users choose which browser engine momus drives for captures. Today the engine
is hardcoded to Chromium in `src/capture/browser.ts`. This adds a `browser`
config field (and `--browser` CLI override) selecting one of Playwright's three
engines: **`chromium`** (default), **`firefox`**, **`webkit`**.

The choice threads through capture, participates in the prod-baseline
compatibility gate (so you can't silently diff a Firefox dev build against a
Chromium baseline), and all three engines are installed by `install-browser` and
baked into the Docker image.

Playwright's "chrome" is not a separate engine — it is the Chromium engine
launched against the branded Google Chrome channel. It is intentionally **out of
scope**; `chromium` already covers the Blink engine.

## 1. Configuration & Schema

Add a top-level `browser` field to `ConfigSchema` (`src/config/schema.ts`):

```ts
browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
```

- Lands in `ResolvedConfig` with a default, so existing configs keep working.
- Invalid values (e.g. `"safari"`) fail Zod validation → clean config error
  (exit 2), consistent with existing validation behavior.
- The `momus init` scaffold (`src/commands/init.ts`) gains a documented
  `browser: "chromium"` line.

## 2. CLI Flag & Override Plumbing

- `src/cli.ts`: add `browser: { type: "string" }` to the `parseArgs` options; map
  `values.browser` into `overrides.browser` when present.
- `src/config/load.ts`: add `browser?: string` to `CliOverrides`; in
  `resolveConfig`, `if (cli.browser !== undefined) merged.browser = cli.browser`.
  Zod's enum validates the merged value — CLI wins over the config-file value.
- Update the `help` usage strings in `src/cli.ts` (both `snapshot` and `run`
  lines) to include `[--browser NAME]`.
- Update the README `snapshot` and `run` flag tables.

## 3. Browser Launch (`src/capture/browser.ts`)

Replace the hardcoded Chromium with an engine map. `newContext` is unchanged (its
options are engine-agnostic).

```ts
import { chromium, firefox, webkit, type BrowserType, type Browser, type BrowserContext } from "playwright-core";
import { existsSync } from "node:fs";

export type BrowserEngine = "chromium" | "firefox" | "webkit";

const ENGINES: Record<BrowserEngine, BrowserType> = { chromium, firefox, webkit };

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
```

- `BrowserEngine` is the single source of truth for the union type; it matches the
  Zod enum values. `ResolvedConfig["browser"]` is assignable to `BrowserEngine`.
- Defaults keep existing call sites (tests, docs) working when they call
  `isBrowserInstalled()` / `launchBrowser()` with no argument.

Call-site changes:

- `src/commands/run.ts` and `src/commands/snapshot.ts`:
  - `isBrowserInstalled(config.browser)` for the presence check.
  - `launchBrowser(config.browser)` for the launch.
  - Config must be resolved **before** the presence check so we know which engine
    to look for. Reorder so config load/resolve happens first; on config error we
    still return exit 2. The "No browser found" message names the engine, e.g.
    `No firefox browser found. Run \`momus install-browser\` first.`

## 4. Baseline Compatibility Gate

Persist the engine in the snapshot and gate on it, mirroring the existing
viewports/stabilize checks.

`src/store/db.ts`:

- `SnapshotMeta` gains `browser: BrowserEngine` (or `string`; validated upstream).
- The `snapshot` table `CREATE TABLE` gains a `browser TEXT` column.
- `writeSnapshot` writes `m.browser`.
- `readSnapshot` reads `row.browser`, defaulting to `"chromium"` when the column
  is null/absent so **pre-existing baselines stay diffable** (backward compat).

`src/pipeline/compat.ts` — `baselineConflict` gains an early check:

```ts
if (config.browser !== snapshot.browser) {
  return `browser differs: config "${config.browser}" vs baseline "${snapshot.browser}"`;
}
```

Snapshot writer (`src/pipeline/snapshot.ts`, wherever `SnapshotMeta` is
assembled): include `browser: config.browser`.

## 5. Installation & Docker

- `src/commands/install.ts`: install **all three** engines. Change the installer
  invocation from `["...","install","chromium"]` to
  `["...","install","chromium","firefox","webkit"]`. Update the fallback help
  text to reference all three (`npx playwright install chromium firefox webkit`).
- `Dockerfile`: install all three engines with system deps
  (`playwright install --with-deps chromium firefox webkit`, matching the
  existing pattern).
- README:
  - Intro / Install section: "Chromium included" → all three engines included.
  - `install-browser` command description: downloads all three engines.
  - Configuration docs: document the new `browser` field and its default.
  - Note that `browser` participates in the baseline compatibility gate (a `run`
    whose `browser` differs from the baseline fails fast, exit 2).

## 6. Testing (TDD)

Write failing tests first, then implement.

- **schema** (`tests/config/*`): `browser` defaults to `"chromium"`; each valid
  value parses; an invalid value is rejected.
- **cli/load**: `--browser firefox` flows into `overrides.browser`; override wins
  over a config-file `browser` value in `resolveConfig`.
- **browser.ts**: `launchBrowser("firefox")` selects the firefox engine and
  `isBrowserInstalled("webkit")` checks the webkit path — using a fake/injected
  engine map or spies so the tests run without real browsers installed.
- **compat**: mismatched `browser` returns a `browser differs: …` reason;
  matching passes; a snapshot row missing `browser` reads back as `"chromium"`
  and thus matches a default-config run.
- Existing integration/e2e tests continue to default to `chromium` (they call
  `launchBrowser()` with no argument).

## Out of Scope

- Google Chrome branded channel (`channel: "chrome"`).
- Per-page or per-viewport browser selection.
- Multi-browser baselines in a single DB (one engine per baseline, gated).
