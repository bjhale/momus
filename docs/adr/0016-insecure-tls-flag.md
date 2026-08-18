# ADR-0016: One `insecure` flag covering both network surfaces

**Date:** 2026-07-05 · **Status:** Accepted

## Context

momus reaches the target sites two different ways, and both reject invalid or
self-signed TLS certificates:

1. **Discovery fetches** — Bun `fetch`, for the sitemap and the crawl.
2. **Browser navigation** — Chromium/Firefox/WebKit page loads via the Playwright
   context.

Testing against a self-signed dev or staging server fails on both, and fixing
only one is useless.

## Decision

A single top-level `insecure: boolean` (default `false`) with a `--insecure` CLI
override, threaded to both surfaces:

- Discovery: Bun's per-request `tls: { rejectUnauthorized: false }`, applied in
  `makeFetcher` (`src/discovery/fetcher.ts`).
- Browser: Playwright's `ignoreHTTPSErrors` on the context.

## Consequences

- This folded the `realFetch` closure — previously duplicated verbatim in both
  commands — into one injectable factory, which is also where `requestHeaders`
  now lives.
- Ignoring certificate validity removes MITM protection, so it is off by default,
  opt-in per run, and documented as being for self-signed dev/staging
  environments only.
- The flag affects certificate *validity* only. DNS failures, connection
  refusals, and HTTP non-2xx still surface as errors exactly as before.
- No per-URL or per-side (dev-only / prod-only) control, and no custom CA bundles
  or client certs. One flag, both surfaces, both sides.
