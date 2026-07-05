# `insecure` (ignore SSL cert validity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, default-off `insecure` config option (with a `--insecure` CLI flag) that makes both the discovery fetch and the Chromium navigation ignore invalid/self-signed TLS certificates.

**Architecture:** A new `makeFetcher(insecure, fetchImpl?)` factory (replacing the duplicated `realFetch`) passes Bun's `tls.rejectUnauthorized: false` when insecure. `newContext`/`capture` gain a defaulted `insecure`/`ignoreHTTPSErrors` parameter forwarding Playwright's `ignoreHTTPSErrors`. A top-level `insecure` config field + `--insecure` flag drive both, wired through both commands.

**Tech Stack:** Bun, TypeScript, Zod, Playwright (playwright-core), `bun:test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- `insecure` is a top-level config field: `z.boolean().default(false)`. Default **off**.
- Discovery fetch: when insecure, `fetch(url, { tls: { rejectUnauthorized: false } })` (Bun per-request TLS bypass); when secure, no init object (`fetch(url)` equivalent) — behavior unchanged.
- Browser: when insecure, `browser.newContext({ ..., ignoreHTTPSErrors: true })`.
- CLI `--insecure` (boolean) overrides config; CLI wins.
- The flag affects only certificate *validity* — DNS/connection failures and HTTP non-2xx still surface as errors as before.
- New/changed function params default to the secure value so existing callers are unaffected.
- Commit after each task.

---

## File Structure

- `src/discovery/fetcher.ts` — **create**: `makeFetcher(insecure, fetchImpl?)` (the one home for the discovery fetcher + TLS option).
- `src/config/schema.ts` — **modify**: add top-level `insecure`.
- `src/config/load.ts` — **modify**: `CliOverrides.insecure` + `resolveConfig` merge.
- `src/cli.ts` — **modify**: parse `--insecure`; help text.
- `src/capture/browser.ts` — **modify**: `newContext` gains `ignoreHTTPSErrors`.
- `src/capture/screenshot.ts` — **modify**: `capture` gains `insecure`, forwards to `newContext`.
- `src/commands/run.ts`, `src/commands/snapshot.ts` — **modify**: use `makeFetcher(config.insecure)`; pass `insecure` into capture closures.
- `src/commands/init.ts`, `README.md` — **modify**: document `insecure`.
- Tests: `tests/discovery/fetcher.test.ts` (new), `tests/config/schema.test.ts`, `tests/cli.test.ts`, `tests/config/load.test.ts`, `tests/capture/browser.test.ts`, `tests/capture/screenshot.test.ts` (new).

---

## Task 1: `makeFetcher` factory + insecure fetch option

**Files:**
- Create: `src/discovery/fetcher.ts`
- Test: `tests/discovery/fetcher.test.ts`

**Interfaces:**
- Consumes: `Fetcher` type from `src/discovery/sitemap`.
- Produces: `makeFetcher(insecure: boolean, fetchImpl?: typeof fetch): Fetcher` — returns a fetcher that passes `{ tls: { rejectUnauthorized: false } }` when insecure, else no init; maps the response to `{ ok, status, text }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/discovery/fetcher.test.ts`:

```typescript
// tests/discovery/fetcher.test.ts
import { test, expect } from "bun:test";
import { makeFetcher } from "../../src/discovery/fetcher";

test("passes tls rejectUnauthorized:false when insecure", async () => {
  let seenInit: any;
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("body", { status: 200 });
  }) as unknown as typeof fetch;

  const f = makeFetcher(true, fake);
  const r = await f("https://x.example");

  expect(seenInit?.tls?.rejectUnauthorized).toBe(false);
  expect(r.ok).toBe(true);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("body");
});

test("passes no init when secure", async () => {
  let seenInit: any = "sentinel";
  const fake = (async (_url: string, init?: any) => {
    seenInit = init;
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  const f = makeFetcher(false, fake);
  const r = await f("https://x.example");

  expect(seenInit).toBeUndefined();
  expect(r.ok).toBe(false);
  expect(r.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/discovery/fetcher.test.ts`
Expected: FAIL — `makeFetcher` is not defined.

- [ ] **Step 3: Implement `src/discovery/fetcher.ts`**

```typescript
// src/discovery/fetcher.ts
import type { Fetcher } from "./sitemap";

/** Build the real HTTP fetcher used for discovery. When `insecure`, invalid or
 * self-signed TLS certificates are accepted (Bun's per-request
 * `tls.rejectUnauthorized: false`). `fetchImpl` is injectable for tests. */
export function makeFetcher(insecure: boolean, fetchImpl: typeof fetch = fetch): Fetcher {
  return async (url: string) => {
    const r = await fetchImpl(url, insecure ? { tls: { rejectUnauthorized: false } } : undefined);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/discovery/fetcher.test.ts`
Expected: PASS (2 tests).

If `bunx tsc --noEmit` flags the `tls` property on the fetch init, it means the ambient Bun types aren't seen for the injected `fetchImpl` call — in that case change the option expression to `insecure ? ({ tls: { rejectUnauthorized: false } } as RequestInit) : undefined`. Verify with `bunx tsc --noEmit` (expected: clean).

- [ ] **Step 5: Commit**

```bash
git add src/discovery/fetcher.ts tests/discovery/fetcher.test.ts
git commit -m "feat: add makeFetcher with opt-in insecure TLS"
```

---

## Task 2: Config `insecure` + `--insecure` CLI

**Files:**
- Modify: `src/config/schema.ts`, `src/config/load.ts`, `src/cli.ts`
- Test: `tests/config/schema.test.ts`, `tests/cli.test.ts`, `tests/config/load.test.ts`

**Interfaces:**
- Produces: `ResolvedConfig.insecure: boolean` (default false); `CliOverrides.insecure?: boolean`; `parseCliArgs` sets `overrides.insecure = true` for `--insecure`; `resolveConfig` merges it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/schema.test.ts`:

```typescript
test("insecure defaults to false and accepts true", () => {
  const d = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(d.insecure).toBe(false);
  const t = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", insecure: true });
  expect(t.insecure).toBe(true);
});
```

Append to `tests/cli.test.ts`:

```typescript
test("parses --insecure", () => {
  expect(parseCliArgs(["run", "--insecure"]).overrides.insecure).toBe(true);
  expect(parseCliArgs(["run"]).overrides.insecure).toBeUndefined();
});
```

Append to `tests/config/load.test.ts`:

```typescript
test("--insecure overrides config.insecure (CLI wins)", () => {
  expect(resolveConfig(base, { insecure: true }).insecure).toBe(true);
  expect(resolveConfig({ ...base, insecure: false }, { insecure: true }).insecure).toBe(true);
  expect(resolveConfig(base, {}).insecure).toBe(false); // default
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/config/schema.test.ts tests/cli.test.ts tests/config/load.test.ts`
Expected: FAIL — `insecure` is stripped/undefined; `--insecure` not parsed.

- [ ] **Step 3: Add `insecure` to the schema**

In `src/config/schema.ts`, add the field right after the `prod:` line inside `ConfigSchema`:

```typescript
  insecure: z.boolean().default(false),
```

- [ ] **Step 4: Add the override to `load.ts`**

In `src/config/load.ts`, add to `CliOverrides`:

```typescript
  insecure?: boolean;
```

And add this merge in `resolveConfig` (after the `crawl` block, before `return`):

```typescript
  if (cli.insecure !== undefined) merged.insecure = cli.insecure;
```

- [ ] **Step 5: Parse `--insecure` in `cli.ts`**

In `parseCliArgs`, add to the `options` object:

```typescript
      insecure: { type: "boolean" },
```

And after the `crawl` mapping (`if (values.crawl) overrides.crawl = true;`):

```typescript
  if (values.insecure) overrides.insecure = true;
```

Update the help-text `console.log` usage lines to include `[--insecure]` for both `snapshot` and `run`:

```typescript
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus snapshot [--prod URL] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure]\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure]`);
```

- [ ] **Step 6: Run to verify they pass**

Run: `bun test tests/config/schema.test.ts tests/cli.test.ts tests/config/load.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/config/load.ts src/cli.ts tests/config/schema.test.ts tests/cli.test.ts tests/config/load.test.ts
git commit -m "feat: add insecure config field + --insecure CLI flag"
```

---

## Task 3: Thread `insecure` through `newContext` + `capture`

**Files:**
- Modify: `src/capture/browser.ts`, `src/capture/screenshot.ts`
- Test: `tests/capture/browser.test.ts`, `tests/capture/screenshot.test.ts` (new)

**Interfaces:**
- Produces:
  - `newContext(browser: Browser, viewportWidth: number, ignoreHTTPSErrors?: boolean): Promise<BrowserContext>` — forwards `ignoreHTTPSErrors` (default false).
  - `capture(browser, url, viewportWidth, opts, insecure?: boolean): Promise<CaptureResult>` — forwards `insecure` to `newContext` (default false).

- [ ] **Step 1: Write the failing tests**

Append to `tests/capture/browser.test.ts`:

```typescript
import { newContext } from "../../src/capture/browser";

test("newContext sets ignoreHTTPSErrors when insecure", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280, true);
  expect(opts.ignoreHTTPSErrors).toBe(true);
});

test("newContext defaults ignoreHTTPSErrors to false", async () => {
  let opts: any;
  const fakeBrowser = { newContext: async (o: any) => { opts = o; return {} as any; } } as any;
  await newContext(fakeBrowser, 1280);
  expect(opts.ignoreHTTPSErrors).toBe(false);
});
```

Create `tests/capture/screenshot.test.ts`:

```typescript
// tests/capture/screenshot.test.ts
import { test, expect } from "bun:test";
import { capture } from "../../src/capture/screenshot";

const STAB = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 1000, disableAnimations: true, mask: [] };

// A fake browser whose context throws on newPage, so capture returns {ok:false}
// AFTER recording the context options — lets us assert the insecure threading
// without a real Chromium.
function fakeBrowser(record: (o: any) => void) {
  return {
    newContext: async (o: any) => {
      record(o);
      return { newPage: async () => { throw new Error("stop after context"); }, close: async () => {} };
    },
  } as any;
}

test("capture threads insecure through to the browser context", async () => {
  let opts: any;
  const res = await capture(fakeBrowser((o) => { opts = o; }), "https://x.example", 1280, STAB, true);
  expect(opts.ignoreHTTPSErrors).toBe(true);
  expect(res.ok).toBe(false); // newPage threw → recorded as error, never propagated
});

test("capture defaults to a secure context", async () => {
  let opts: any;
  await capture(fakeBrowser((o) => { opts = o; }), "https://x.example", 1280, STAB);
  expect(opts.ignoreHTTPSErrors).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/capture/browser.test.ts tests/capture/screenshot.test.ts`
Expected: FAIL — `newContext` ignores the 3rd arg (no `ignoreHTTPSErrors` on opts); `capture` ignores the 5th arg.

- [ ] **Step 3: Update `src/capture/browser.ts`**

Replace the `newContext` function with:

```typescript
export async function newContext(
  browser: Browser, viewportWidth: number, ignoreHTTPSErrors = false,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewportWidth, height: 900 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors,
  });
}
```

- [ ] **Step 4: Update `capture` in `src/capture/screenshot.ts`**

Add the 5th parameter to the `capture` signature and pass it to `newContext`. Change the signature block:

```typescript
export async function capture(
  browser: Browser,
  url: string,
  viewportWidth: number,
  opts: StabilizeOptions,
  insecure = false,
): Promise<CaptureResult> {
```

And change the `newContext(...)` call (inside the `try`) from `await newContext(browser, viewportWidth)` to:

```typescript
    context = await newContext(browser, viewportWidth, insecure);
```

- [ ] **Step 5: Run to verify they pass**

Run: `bun test tests/capture/browser.test.ts tests/capture/screenshot.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/capture/browser.ts src/capture/screenshot.ts tests/capture/browser.test.ts tests/capture/screenshot.test.ts
git commit -m "feat: thread insecure through capture -> newContext (ignoreHTTPSErrors)"
```

---

## Task 4: Wire commands + docs + scaffold

**Files:**
- Modify: `src/commands/run.ts`, `src/commands/snapshot.ts`, `src/commands/init.ts`, `README.md`

**Interfaces:**
- Consumes: `makeFetcher` (Task 1); `config.insecure` (Task 2); `capture`'s 5th param (Task 3).

- [ ] **Step 1: Wire `src/commands/run.ts`**

Add the import near the other discovery imports:

```typescript
import { makeFetcher } from "../discovery/fetcher";
```

Replace the inline `realFetch` block:

```typescript
  const realFetch = async (url: string) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
```

with:

```typescript
  const realFetch = makeFetcher(config.insecure);
```

Update the two capture closures to pass `insecure`:

```typescript
      captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize, cfg.insecure),
      getDev: (job: Job) => capture(browser, job.devUrl, job.viewport, config.stabilize, config.insecure),
```

- [ ] **Step 2: Wire `src/commands/snapshot.ts`**

Add the import:

```typescript
import { makeFetcher } from "../discovery/fetcher";
```

Replace the inline `realFetch` block (identical to run.ts's) with:

```typescript
  const realFetch = makeFetcher(config.insecure);
```

Update the capture closure:

```typescript
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize, cfg.insecure),
```

- [ ] **Step 3: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS; no type errors. (Both commands now route discovery through `makeFetcher(config.insecure)` and pass `insecure` into every capture.)

- [ ] **Step 4: Update the `init` scaffold**

In `src/commands/init.ts`, add a commented `insecure` line right after the `prod:` line in the `configScaffold()` template string:

```typescript
  dev: "https://dev.example.com",
  prod: "https://www.example.com",
  // insecure: false,   // set true to ignore invalid/self-signed TLS certs (dev only)
```

- [ ] **Step 5: Update the README config example**

In `README.md`, add the `insecure` line right after the `prod:` line in the `## Configuration` example block:

```markdown
  dev: "https://dev.example.com",   // the build under test
  prod: "https://www.example.com",  // the baseline; also the discovery source
  insecure: false,                  // set true to ignore invalid/self-signed TLS certs (dev only)
```

- [ ] **Step 6: Add `--insecure` to the flag tables + a note**

In `README.md`, add this row to **both** the `momus run [flags]` and `momus snapshot [flags]` flag tables (after the `--max-pages` row):

```markdown
| `--insecure` | Ignore invalid/self-signed TLS certs for discovery fetches and page loads (`insecure`). |
```

And add a bullet to the config "Notes:" list:

```markdown
- **`insecure`** disables TLS certificate validation for both the discovery
  fetches and the browser page loads — for self-signed dev/staging servers. It
  removes MITM protection, so it defaults to `false` and should stay off against
  anything reachable by others; prefer a properly-issued cert or a trusted CA.
```

- [ ] **Step 7: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS.

```bash
git add src/commands/run.ts src/commands/snapshot.ts src/commands/init.ts README.md
git commit -m "feat: wire insecure through both commands; document it"
```

---

## Self-Review

**1. Spec coverage:**
- §1 config + CLI (`insecure` schema, `CliOverrides`, parse, merge, help) → Task 2. ✓
- §2 discovery fetch (`makeFetcher` + tls bypass; commands use it) → Task 1 (factory) + Task 4 (wiring). ✓
- §3 browser (`newContext` `ignoreHTTPSErrors`; `capture` threading; command closures) → Task 3 + Task 4 (closures). ✓
- §4 security note → Task 4 (README note). ✓
- §5 edge cases (default off unchanged; validity-only) → covered by defaults in Tasks 1–3 and their tests. ✓
- §6 testing (schema/cli/load/makeFetcher/newContext/capture) → Tasks 1–3 tests. ✓
- §7 docs (README example + note + flag tables; init scaffold) → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code. ✓

**3. Type consistency:** `makeFetcher(insecure, fetchImpl?)` (Task 1) used by both commands (Task 4). `ResolvedConfig.insecure` (Task 2) read by the command closures (Task 4). `newContext(browser, vw, ignoreHTTPSErrors?)` (Task 3) called by `capture(browser, url, vw, opts, insecure?)` (Task 3), whose 5th arg the command closures supply (Task 4). `Fetcher` return shape `{ ok, status, text }` matches the existing `realFetch`. ✓

**Note for the implementer:** Task 4 has no dedicated tests — its correctness is that both commands route through `makeFetcher(config.insecure)` and pass `insecure`/`cfg.insecure` into every `capture` call; the `bun test && bunx tsc --noEmit` gate (Step 3) plus the unit tests of the pieces cover it. Do not add a real-Chromium test for the SSL bypass.
