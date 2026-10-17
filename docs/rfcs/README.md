# RFCs

Proposals for large features on the [roadmap](../../ROADMAP.md). An RFC is a
proposal and is expected to change while it's discussed. An
[ADR](../adr/README.md) is a decision and is immutable. An RFC that ships
leaves ADRs behind.

## Lifecycle

| Status | Meaning |
| --- | --- |
| **Draft** | Direction agreed, design open. Open questions are expected. |
| **Accepted** | Open questions answered; ready for an implementation plan. |
| **Implemented** | Shipped. Link the ADRs that record its decisions, and the release. |
| **Withdrawn** | Not pursuing. Say why in the RFC; don't delete it. |

Edit an RFC freely while it is Draft. Once it is Accepted, changes of substance
go in a dated "Revisions" section at the bottom, so reviewers can see what moved.

## Template

Each RFC has these sections:

- **Summary:** one paragraph.
- **Motivation:** the user problem, not the solution.
- **Today:** how momus behaves now, with links to code and ADRs.
- **Proposal:** the shape of the solution. Concrete enough to disagree with,
  without being an implementation plan.
- **Non-goals**
- **Compatibility:** how existing configs, CLI scripts and `.sqlite` files keep
  working, and whether the change touches the baseline compatibility gate
  ([ADR-0010](../adr/0010-baseline-compatibility-gate.md)).
- **Open questions**
- **Done when:** a checklist that can be verified.

## Index

| # | Title | Milestone | Status |
| --- | --- | --- | --- |
| [0001](0001-targets.md) | Targets: generalize "page path" | M1 | Implemented |
| [0002](0002-storage-and-run-history.md) | Storage versioning and run history | M1 | Implemented |
| [0003](0003-approval-workflow.md) | Approved baselines and the approval workflow | — | Withdrawn (to 2.0, [ADR-0028](../adr/0028-approval-belongs-to-the-server.md)) |
| [0004](0004-scripted-interactions.md) | Scripted interactions, element capture, and auth | M3 | Draft |
| [0005](0005-storybook.md) | Storybook stories as targets | — | Withdrawn |
| [0006](0006-capture-determinism-and-diff-quality.md) | Capture determinism and diff quality | M5 | Draft |
| [0007](0007-review-report.md) | Review report v2 | M6 | Draft |
| [0008](0008-cli-ci-integration.md) | CLI CI integration | M6 | Draft |
| [0009](0009-stability-contract.md) | The 1.0 stability contract | 1.0 | Draft |
| [0010](0010-server.md) | The momus server | 2.0 | Draft |
