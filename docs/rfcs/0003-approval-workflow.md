# RFC-0003: Approved baselines and the approval workflow

**Status:** Draft · **Milestone:** M2 · **Created:** 2026-10-16

## Summary

Let a developer approve a run's captures so they become the baseline, per
target or all at once. A baseline can then come from either of two sources: a
live **prod** capture (today) or **approved** captures (new). Approved
baselines let momus test things that have no prod to compare against, such as a
new feature or a Storybook, and make an intended change pass the next run.

## Motivation

Today a baseline is "whatever prod looked like when it was snapshotted." That
leaves a few cases unhandled:

- **An intentional change fails forever.** The redesigned header differs from
  prod on every run until the change is deployed and prod is re-snapshotted.
- **No prod at all.** Scenarios, stories, and pre-launch sites have nothing to
  diff against.
- **The baseline can't be curated.** One bad page means re-capturing all of
  prod.

Every serious visual regression tool has an "accept this change" step.

## Today

- The baseline is all of prod, captured at once and then frozen
  ([ADR-0011](../adr/0011-run-always-diffs-a-baseline.md),
  [ADR-0020](../adr/0020-run-snapshot-flag.md)).
- Nothing records whether a diff was intended.

## Proposal

### Commands

```text
momus approve [--run ID] [--target GLOB]... [--failed | --all]
momus reject  [--run ID] [--target GLOB]...
momus baseline status      # source, age, and per-target provenance
momus baseline drop --target GLOB...   # delete baseline rows
```

- `approve` copies the run's **dev** capture for each matching
  `(target, viewport)` into `baseline_images`, recording the source run and the
  time of approval. By default it approves only the targets that failed.
- `reject` records a decision without changing the baseline. The report shows
  it, and a later approval of the same capture refuses unless forced.
- `--run` defaults to the latest run.
- `baseline drop` deletes matching rows from the baseline. It is the only way
  to retire a page short of a full snapshot, because pages are never reported
  `removed` ([RFC-0001](0001-targets.md)).

### Baseline sources

- `baseline.source: "prod" | "approved"`; default `"prod"`, which is today's
  behavior.
- With `"prod"`, approval overrides individual targets on top of the prod
  snapshot. A later `momus snapshot` asks whether to keep those approvals, and
  the flags `--keep-approved` and `--discard-approved` answer that question
  without the prompt.
- With `"approved"`, there is no prod. A target with no approved baseline is
  `added`, using [RFC-0001](0001-targets.md)'s added and removed statuses
  rather than an error. The report shows the dev capture alone, and `approve`
  adopts it. It fails by default (`--allow-added` to pass), so an unreviewed
  target can't slip through. On the first run of an approved-source project
  every target is `added`, and `approve --all` is how the baseline is seeded.
- Approving a `removed` target deletes its row from the baseline.

### Committing the baseline

Teams that want baselines reviewed in pull requests need the baseline in git.
SQLite BLOBs in git are opaque and diff badly, so this RFC adds:

```text
momus baseline export <dir>   # one PNG + one JSON sidecar per target × viewport
momus baseline import <dir>
```

The PNG directory is what gets committed, and GitHub renders changes to it in a
PR. The `.sqlite` stays a cache that can be rebuilt from it.

## Non-goals

- Approval by multiple people, permissions, or audit trails. That is the
  server's job ([RFC-0010](0010-server.md)).
- Per-branch baselines. Also the server's job.

## Compatibility

- The default source is `"prod"` and approvals are opt-in, so existing configs
  are unchanged.
- An approved image must have been captured under the baseline's
  compatibility identity. `approve` refuses captures from a run whose
  engine, viewports, or recipes differ from the baseline's. Otherwise approval
  would launder an incompatible capture into the baseline.

## Open questions

- Is the export directory the source of truth (with `.sqlite` derived), or a
  serialization of the `.sqlite`? The first fits git workflows; the second keeps
  one source of truth.
- Should approval happen in the report ([RFC-0007](0007-review-report.md))?
  The report is a static file, so it can only produce a list of approvals for
  the CLI to apply. Is that good enough?

## Done when

- [ ] `approve`, `reject`, `baseline status` and `baseline drop` work against
      run history.
- [ ] `baseline.source: "approved"` works with no prod configured, including
      seeding the baseline with `approve --all` from an all-`added` first run.
- [ ] Approving `added` and `removed` targets updates the baseline as
      described.
- [ ] Export, then import, round-trips a baseline byte-for-byte.
- [ ] Approving an incompatible capture is refused.
- [ ] ADRs record the source model and the export format.
