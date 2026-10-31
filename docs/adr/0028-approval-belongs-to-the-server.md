# ADR-0028: Approval belongs to the server, not 1.x

**Date:** 2026-10-17 · **Status:** Accepted · **Withdraws:** [RFC-0003](../rfcs/0003-approval-workflow.md)

## Context

[RFC-0003](../rfcs/0003-approval-workflow.md) proposed approval for the 1.x
CLI. Under it, `momus approve` and `momus reject` would act on run history, a
`baseline.source: "approved"` mode would need no prod, and
`baseline export`/`import` would let a baseline be committed to git. It was
milestone M2, and RFC-0007 (the report's approval list) depended on it.

Its open questions were not CLI questions. Is the committed directory or the
`.sqlite` the source of truth? Who approved a change, and how does an approval
made on a feature branch reach main? These are the questions the 2.0 server
([RFC-0010](../rfcs/0010-server.md)) exists to answer, through per-branch
baselines, shared review, and provenance per user. Answering them for one user
and one file in 1.x would freeze those answers into the 1.0 contract
([RFC-0009](../rfcs/0009-stability-contract.md)). The server would then have
to stay compatible with them.

## Decision

Withdraw RFC-0003. Approval is designed and built with the server.

- In 1.x the baseline is always a prod snapshot
  ([ADR-0011](0011-run-always-diffs-a-baseline.md)). There is no
  `baseline.source`, no `approve`/`reject`, no `baseline drop`, and no
  `baseline export`/`import`.
- `added` and `removed` ([ADR-0022](0022-added-and-removed-targets.md)) are
  resolved by re-snapshotting or tolerated with `--allow-added` and
  `--allow-removed`. ADR-0022's mentions of `momus baseline drop` and of
  approval no longer describe planned work.
- The report (RFC-0007) keeps review and triage but produces no approval list,
  so the 1.0 contract has no approval-list schema.

## Consequences

- 1.x scope gets smaller. M2 is gone, and M6 no longer waits on it.
- An intended change fails every run until prod is re-snapshotted. That is
  today's behavior, and with this decision it stays that way through 1.x.
- A target with no prod has no baseline in 1.x, so pre-launch sites and new
  features can't be gated until they exist somewhere prod-like.
- This weakens the roadmap's principle that a team which never runs the server
  still has a complete tool. Whether a server-free `momus approve` comes later
  is an open question in RFC-0010. If it does, it must share the server's
  model.
- Nothing in 1.x can presume a baseline source other than a prod snapshot. The
  server then adds approved baselines as a new capability, not as a break.
