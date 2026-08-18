# Architecture Decision Records

One record per decision that would be expensive to reverse or surprising to
rediscover. Each states the context, the decision, and what it cost.

Records are immutable once accepted. When a decision changes, add a new record
that amends or supersedes the old one and link them both ways rather than editing
history — [ADR-0020](0020-run-snapshot-flag.md) amending
[ADR-0011](0011-run-always-diffs-a-baseline.md) is the worked example.

For how the system fits together today, see [architecture.md](../architecture.md).

| # | Decision | Date |
| --- | --- | --- |
| [0001](0001-bun-playwright-single-binary.md) | Bun + Playwright, shipped as a binary but containerized from source | 2026-07-03 |
| [0002](0002-sqlite-blobs-single-run-db.md) | Images as SQLite BLOBs in a single-run DB | 2026-07-03 |
| [0003](0003-pad-never-scale.md) | Pad mismatched screenshots, never scale | 2026-07-03 |
| [0004](0004-two-threshold-knobs.md) | Two separate threshold knobs, named to keep them apart | 2026-07-03 |
| [0005](0005-split-concurrency-model.md) | Async pool for capture, worker threads for diffing | 2026-07-03 |
| [0006](0006-errors-are-rows.md) | Failures become rows, and errors exit non-zero | 2026-07-03 |
| [0007](0007-never-auto-download-browser.md) | `run` never downloads a browser | 2026-07-03 |
| [0008](0008-discovery-is-single-sided.md) | Discovery runs against prod only | 2026-07-03 |
| [0009](0009-baseline-in-same-db.md) | The prod baseline lives in the same SQLite file | 2026-07-04 |
| [0010](0010-baseline-compatibility-gate.md) | Hard-fail when a baseline isn't diffable against the live config | 2026-07-04 |
| [0011](0011-run-always-diffs-a-baseline.md) | `run` always diffs against a stored baseline, materializing one if absent | 2026-07-04 |
| [0012](0012-maxpages-cap-semantics.md) | One global `maxPages` cap, counted after filtering | 2026-07-04 |
| [0013](0013-crawl-is-opt-in-and-seeded.md) | Crawl is opt-in, and seeds from the other sources | 2026-07-04 |
| [0014](0014-urllist-normalized-to-paths.md) | `urlList` entries normalize to paths; off-base URLs are a hard error | 2026-07-05 |
| [0015](0015-remove-vs-mask.md) | `stabilize.remove` deletes from the DOM; `mask` only hides | 2026-07-05 |
| [0016](0016-insecure-tls-flag.md) | One `insecure` flag covering both network surfaces | 2026-07-05 |
| [0017](0017-report-self-contained-mostly-js-free.md) | Self-contained report, accordions without JS | 2026-07-05 |
| [0018](0018-progress-behind-a-seam.md) | Progress bars behind a three-method seam, rendered to stderr | 2026-07-05 |
| [0019](0019-selectable-browser-engine.md) | Selectable browser engine, gated against the baseline | 2026-07-10 |
| [0020](0020-run-snapshot-flag.md) | `momus run --snapshot` re-captures the baseline in one invocation | 2026-08-18 |

## Open questions

Carried forward from the records above, unresolved:

- **All-error materialize freezes a broken baseline.** If the first `run`
  materializes while prod is unreachable, the baseline freezes with all-error
  rows and is reused until `momus snapshot` runs again.
  ([ADR-0011](0011-run-always-diffs-a-baseline.md))
- **The compatibility gate ignores `prod_base_url`.** A DB pointed at a second
  site diffs against the first site's baseline and reports garbage that looks
  clean. ([ADR-0010](0010-baseline-compatibility-gate.md),
  [ADR-0020](0020-run-snapshot-flag.md))
