# Design: `insecure` — ignore SSL certificate validity

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Problem

momus hits the dev/prod URLs from two network surfaces, both of which reject
invalid/self-signed TLS certificates:

1. **Discovery fetch** — the `realFetch` closure (Bun `fetch`) used for sitemap +
   crawl, in `src/commands/run.ts` and `src/commands/snapshot.ts`.
2. **Browser navigation** — Chromium page loads via the Playwright context
   created in `src/capture/browser.ts` (`newContext`).

Testing against a self-signed dev/staging server fails on both. We want an opt-in
option to ignore certificate validity across both surfaces.

## Decisions (from brainstorming)

1. **Scope:** both the discovery fetch and the browser navigations.
2. **Naming:** top-level config `insecure: boolean` (default `false`) with a
   `--insecure` CLI override.

## 1. Config + CLI

- Schema: add top-level `insecure: z.boolean().default(false)` to `ConfigSchema`.
- `CliOverrides` gains `insecure?: boolean`.
- `cli.ts`: add `insecure: { type: "boolean" }` to `parseArgs` options; set
  `overrides.insecure = true` when the flag is present.
- `resolveConfig`: `if (cli.insecure !== undefined) merged.insecure = cli.insecure;`
  (CLI wins over config).
- Help text: add `[--insecure]` to the `run` and `snapshot` usage lines.

## 2. Discovery fetch — extract `makeFetcher`

The `realFetch` closure is duplicated verbatim in both commands. Fold it into one
factory that also carries the insecure option:

```ts
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

Both commands replace their inline `const realFetch = async (url) => {...}` with
`const realFetch = makeFetcher(config.insecure);`.

Notes:
- `tls: { rejectUnauthorized: false }` is Bun's fetch TLS option (momus is
  Bun-only). If `@types/bun`'s `RequestInit` needs it, the type is already
  present; no cast expected.
- The `fetchImpl` default is the global `fetch`; tests inject a fake to assert
  the init object.

## 3. Browser navigation — thread through `newContext` + `capture`

`newContext` gains a defaulted third parameter and forwards Playwright's own
`ignoreHTTPSErrors`:

```ts
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

`capture` gains a defaulted 5th parameter and passes it down:

```ts
export async function capture(
  browser: Browser, url: string, viewportWidth: number, opts: StabilizeOptions,
  insecure = false,
): Promise<CaptureResult> {
  // ...
  context = await newContext(browser, viewportWidth, insecure);
  // ...
}
```

Command capture closures pass the flag from config:
- `src/pipeline/run-flow.ts` / `src/commands/run.ts`: `captureProd: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize, cfg.insecure)` and `getDev: (job) => capture(browser, job.devUrl, job.viewport, config.stabilize, config.insecure)`.
- `src/commands/snapshot.ts`: `captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize, cfg.insecure)`.

Existing 4-arg `capture(browser, url, vw, opts)` calls in the e2e tests keep
compiling (the 5th param defaults to `false`; those tests hit local http).

## 4. Security note

Ignoring certificate validity removes MITM protection, so `insecure` defaults
**off** and is opt-in per run or config. Documented as intended for self-signed
dev/staging environments only.

## 5. Edge cases

- `insecure: false` (default) → behavior identical to today (no `tls` init; no
  `ignoreHTTPSErrors`).
- CLI `--insecure` with no config field set → `insecure: true` for that run.
- The flag affects only cert *validity* — DNS/connection failures and HTTP
  non-2xx still surface as errors exactly as before.

## 6. Testing

- **schema** (`tests/config/schema.test.ts`): `insecure` defaults `false`; a
  config with `insecure: true` parses to `true`.
- **cli** (`tests/cli.test.ts`): `--insecure` → `overrides.insecure === true`;
  absent → `overrides.insecure` undefined.
- **load** (`tests/config/load.test.ts`): `resolveConfig(base, { insecure: true })`
  → `c.insecure === true`; CLI wins over a config value.
- **`makeFetcher`** (`tests/discovery/fetcher.test.ts`, injected `fetchImpl`):
  passes `{ tls: { rejectUnauthorized: false } }` when insecure; passes
  `undefined` init when secure; returns `{ ok, status, text }` mapping.
- **`newContext`** (`tests/capture/browser.test.ts`, fake browser): sets
  `ignoreHTTPSErrors: true` when insecure; falsy (default) otherwise.
- **`capture` threading** (`tests/capture/*`, fake browser recording the context
  options; `newPage` throws so `capture` returns `{ok:false}` but the option was
  already recorded): passes `insecure` through to `newContext`.

## 7. Docs

- README config example: add `insecure: false` to the config block; a note
  describing the option and the security caveat.
- `--insecure` row in both the `run` and `snapshot` flag tables.
- `init` scaffold (`src/commands/init.ts`): add a commented `// insecure: false,`
  line.

## Out of scope

- Per-URL or per-side (dev-only / prod-only) SSL control — one global flag covers
  both surfaces and both sides.
- Custom CA bundles / client certs.
