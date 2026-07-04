# Playwright + `bun build --compile` spike result

**Date:** 2026-07-03 · **Bun:** 1.3.14 · **Playwright:** 1.61.1

## Outcome: GO (Playwright, no puppeteer-core fallback needed)

- `bun run spike/screenshot-spike.ts` — works, captured 19288 bytes.
- `bun build spike/screenshot-spike.ts --compile --outfile spike-bin` — **fails**
  with `Could not resolve "chromium-bidi/lib/cjs/bidiMapper/BidiMapper"`:
  Playwright's `playwright-core` has dynamic `require()`s for the BiDi protocol
  that Bun's bundler cannot resolve statically.
- `bun build ... --compile --external chromium-bidi --outfile spike-bin` —
  **succeeds**, and `./spike-bin` runs standalone and captures 19288 bytes.
  BiDi is only used for the WebDriver-BiDi transport; we drive Chromium over
  CDP (the default), so that code path is never taken at runtime and marking it
  external is safe.

## Consequences for the implementation

1. **`build.ts` (Task 7.6) MUST pass `external: ["chromium-bidi"]`** (or the CLI
   `--external chromium-bidi`), or the binary won't compile.
2. **API correction:** `executablePath` is NOT a top-level export of the
   `playwright` package. Use `import { chromium } from "playwright"` and
   `chromium.executablePath()`. The full `playwright` package auto-resolves the
   Chromium it installed, so `chromium.launch()` needs no explicit path.
   `browser.ts` (Task 3.2) uses this instead of the plan's original
   `import { executablePath } from "playwright"`.
