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
| [0017](0017-report-self-contained-mostly-js-free.md) | Self-contained report, accordions without JS (superseded by 0037) | 2026-07-05 |
| [0018](0018-progress-behind-a-seam.md) | Progress bars behind a three-method seam, rendered to stderr | 2026-07-05 |
| [0019](0019-selectable-browser-engine.md) | Selectable browser engine, gated against the baseline | 2026-07-10 |
| [0020](0020-run-snapshot-flag.md) | `momus run --snapshot` re-captures the baseline in one invocation | 2026-08-18 |
| [0021](0021-targets-and-source-provenance.md) | Targets replace page paths; `source` is provenance, not behavior | 2026-10-16 |
| [0022](0022-added-and-removed-targets.md) | Added/removed targets are their own statuses; the baseline determines page paths | 2026-10-16 |
| [0023](0023-per-target-recipe-gate.md) | A target's recipe is gated per target | 2026-10-16 |
| [0024](0024-versioned-schema-migrations.md) | Versioned schema migrations; a newer DB is refused | 2026-10-17 |
| [0025](0025-run-history.md) | Run history: inserted runs, never-reused ids, `keepRuns` retention | 2026-10-17 |
| [0026](0026-prod-origin-in-the-gate.md) | The prod origin joins the compatibility gate | 2026-10-17 |
| [0027](0027-atomic-baseline-replacement.md) | A baseline is replaced atomically; an all-error capture doesn't freeze | 2026-10-17 |
| [0028](0028-approval-belongs-to-the-server.md) | Approval belongs to the server, not 1.x | 2026-10-17 |
| [0029](0029-scenarios-and-step-order.md) | Scenarios are declarative steps; animations off before steps, mask and remove after | 2026-10-17 |
| [0030](0030-setup-per-side.md) | Setup runs once per side; prod logs in only for a baseline; only prod's redacted setup is gated | 2026-10-17 |
| [0031](0031-per-engine-test-processes.md) | Each non-default browser engine's tests run in their own process (superseded by 0036) | 2026-10-17 |
| [0032](0032-determinism-defaults-and-old-baselines.md) | Determinism settings are gated; an older baseline reads as what it was captured with | 2026-10-18 |
| [0033](0033-rendering-environment-in-the-gate.md) | The rendering environment is one gated value, set by the Docker image | 2026-10-18 |
| [0034](0034-unstable-and-retries.md) | An unstable baseline image never fails the gate; `retries` re-captures dev only | 2026-10-18 |
| [0035](0035-change-regions-and-the-pad-band.md) | Change regions are grid-clustered boxes; the pad band is magenta and counts as a region | 2026-10-18 |
| [0036](0036-bun-1-4-3-one-test-process.md) | Bun 1.4.3, because 1.3.14 double-closes child-process descriptors; browser tests share one process | 2026-10-19 |
| [0037](0037-report-requires-javascript.md) | The report requires JavaScript; images can be linked or previewed as WebP thumbnails | 2026-10-19 |

## Open questions

None. The two carried forward from ADR-0010/0011 were resolved by
[ADR-0026](0026-prod-origin-in-the-gate.md) and
[ADR-0027](0027-atomic-baseline-replacement.md).
