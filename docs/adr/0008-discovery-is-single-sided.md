# ADR-0008: Discovery runs against prod only

**Date:** 2026-07-03 · **Status:** Accepted

## Context

momus compares the same path on two deployments. Something has to decide what
"the page set" is. It could be discovered from prod, from dev, or from the union
of both.

## Decision

**Prod is the discovery source of truth.** The sitemap is fetched from the prod
base URL, the crawl (when enabled) runs against prod, and the resulting paths are
then requested on *both* bases. Pairing is by URL path.

## Consequences

- A page that exists **only on dev** — a brand-new unreleased page not yet in
  prod's sitemap — is not discovered and not compared. This is intentional:
  momus reports drift on the known page set, and a page with no prod counterpart
  has nothing to diff against.
- A page that exists on prod but not dev is discovered and then fails to load on
  the dev side, which is exactly the signal you want — it surfaces as an error
  comparison ([ADR-0006](0006-errors-are-rows.md)).
- Because discovery is prod-side, it belongs to the baseline. Once a baseline is
  frozen, `run` does not re-discover; the path set comes from `baseline_images`
  ([ADR-0011](0011-run-always-diffs-a-baseline.md)).
- `discovery.urlList` entries given as full URLs must therefore be under the prod
  base ([ADR-0014](0014-urllist-normalized-to-paths.md)).
