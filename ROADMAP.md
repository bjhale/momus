# momus roadmap

## Where this is going

momus aims to be a world-class open-source visual regression system. It gets
there in two stages:

1. **1.x: a CLI developers reach for first.** Point it at a site or a set of
   scripted scenarios. It captures deterministically, diffs
   honestly, lets you review changes, and gates CI. All of it works with
   nothing but the Docker image and a `.sqlite` file.
2. **2.x: a server that remembers.** The same CLI uploads its results to a
   self-hostable service. The service tracks history over time, holds a
   baseline per branch, gives a team one place to review and approve changes,
   and posts status checks back to pull requests.

The CLI is not a thin client for the server, and 1.x is not a demo for 2.x. A
team that never runs the server should still have a complete tool.

## What 1.0 means

1.0 is a **feature bar** and a **frozen contract**. Both are required:

- **Feature bar.** Every milestone below, M1 through M6 except the withdrawn
  M2 and M4, has shipped.
- **Contract.** The config schema, CLI commands and flags, exit codes, the
  `.sqlite` format, and the programmatic API are covered by semver. A 1.x
  release never breaks a config file, a CI script, or a stored baseline. See
  [RFC-0009](docs/rfcs/0009-stability-contract.md).

Each milestone ships as one or more `0.x` releases. Until 1.0, minor versions may
break things, and the changelog says so when they do.

## Milestones to 1.0

| Milestone | Theme | RFCs | Status |
| --- | --- | --- | --- |
| **M1** Foundations | Close the known correctness gaps. Keep run history. Version the DB. Generalize "page path" into a *target*. | [0001](docs/rfcs/0001-targets.md), [0002](docs/rfcs/0002-storage-and-run-history.md) | In progress |
| ~~**M2** Approved baselines~~ | Moved to 2.0 ([ADR-0028](docs/adr/0028-approval-belongs-to-the-server.md)). | [0003](docs/rfcs/0003-approval-workflow.md) | Withdrawn |
| **M3** Interactions & auth | Per-target steps, element screenshots, and a login/setup phase. | [0004](docs/rfcs/0004-scripted-interactions.md) | Done |
| ~~**M4** Components~~ | No Storybook-specific support; stories are listed as pages. | [0005](docs/rfcs/0005-storybook.md) | Withdrawn |
| **M5** Signal quality | Fewer false diffs; honest reporting of the ones that remain. | [0006](docs/rfcs/0006-capture-determinism-and-diff-quality.md) | Done |
| **M6** Review & CI ergonomics | Report v2 for review and triage; machine-readable output; a GitHub Action. | [0007](docs/rfcs/0007-review-report.md), [0008](docs/rfcs/0008-cli-ci-integration.md) | In progress |
| **1.0** | Freeze the contract. | [0009](docs/rfcs/0009-stability-contract.md) | Not started |

### Ordering

M1 comes first because the rest depend on it. Interactions (M3) are a new kind
of target, and M1's target abstraction is what lets them in without forking the
pipeline.

After M1, milestones M3, M5 and M6 are largely independent and can overlap. 1.0
comes last because a contract shouldn't be frozen while features are still
reshaping it.

M2, approved baselines, was withdrawn and moved to the server
([ADR-0028](docs/adr/0028-approval-belongs-to-the-server.md)). In 1.x the
baseline is always a prod snapshot. An intended change is accepted by
re-snapshotting prod, or tolerated with `--allow-added` and `--allow-removed`.

M4, Storybook stories as targets, was withdrawn: momus has no
Storybook-specific support, and a story's iframe URL goes in `urlList` like any
other page ([RFC-0005](docs/rfcs/0005-storybook.md)).

### M1 also fixes the known gaps

These were recorded in [AGENTS.md](AGENTS.md) and the
[ADR open questions](docs/adr/README.md#open-questions), and are fixed in
RFC-0002. They shipped in M1 because
they make results wrong while looking right, which is worse than missing a
feature:

- **The compatibility gate ignores `prod_base_url`.** A DB pointed at a
  different site diffs against the first site's baseline.
  Fixed in RFC-0002 ([ADR-0026](docs/adr/0026-prod-origin-in-the-gate.md)).
- **`--prod` on `run` is a silent no-op** when a baseline exists.
  Fixed in RFC-0002 ([ADR-0026](docs/adr/0026-prod-origin-in-the-gate.md)).
- **An all-error materialize freezes a broken baseline.**
  Fixed in RFC-0002 ([ADR-0027](docs/adr/0027-atomic-baseline-replacement.md)).
- **`momus snapshot --snapshot`** parses and does nothing.
  Fixed in RFC-0002 ([ADR-0026](docs/adr/0026-prod-origin-in-the-gate.md)).

## 2.0: the server

The draft is [RFC-0010](docs/rfcs/0010-server.md). It is a direction, not a
design. It will be rewritten once 1.0 has taught us what teams actually need.

In outline:

- The CLI gains `momus upload`, sending a run to the server.
- History and trends per target over time.
- Approving and rejecting changes, so approved captures become the baseline
  (formerly M2, [RFC-0003](docs/rfcs/0003-approval-workflow.md)).
- A baseline per branch, inherited from the default branch.
- A review UI the whole team shares.
- Status checks and PR comments on GitHub and GitLab.
- Object storage for images.
- Multiple projects, with authentication.

### What 1.x owes 2.0

The server must not force a breaking change to the 1.x contract. So two 1.x
formats are designed from the start as the server's input:

- the run-history schema ([RFC-0002](docs/rfcs/0002-storage-and-run-history.md)), and
- the JSON results output ([RFC-0008](docs/rfcs/0008-cli-ci-integration.md)).

Those RFCs carry a "server-ready" checklist for that reason.

## Not planned

- **Distribution other than the Docker image.** No npm package and no
  standalone binary. Shipping Playwright with a browser that matches it is what
  the image solves ([ADR-0001](docs/adr/0001-bun-playwright-single-binary.md)).
  Revisit only if a concrete use case can't run a container.
- **A hosted SaaS.** The 2.0 server is self-hostable. A hosted offering is a
  separate decision, not a roadmap item.
- **Native mobile or desktop apps.** momus captures what Playwright's three
  engines (Chromium, Firefox, WebKit) render.

## How this roadmap works

- **RFCs** in [docs/rfcs/](docs/rfcs/) are proposals. Each describes a problem,
  a proposed shape, its non-goals, open questions, and a "done when" checklist.
  An RFC is expected to change while it's being discussed.
- **ADRs** in [docs/adr/](docs/adr/) are decisions, and they are immutable once
  accepted. When an RFC is implemented, record each decision a future reader
  would otherwise have to reverse-engineer as an ADR. Then mark the RFC
  `Implemented` and link the ADRs.
- **This file** changes when a milestone's scope or status changes. Keep it
  short; detail belongs in the RFCs.
