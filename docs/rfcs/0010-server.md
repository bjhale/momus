# RFC-0010: The momus server

**Status:** Draft · **Milestone:** 2.0 · **Created:** 2026-10-16

> This is a direction, not a design. It exists so the 1.x work can avoid
> decisions that would make 2.0 painful. Rewrite it once 1.0 has shipped and
> real teams have used it.

## Summary

A self-hostable service that the momus CLI uploads runs to. It keeps history
over time, holds baselines per branch, gives a team one place to review and
approve, and reports back to pull requests through status checks. The CLI keeps
working alone; the server adds memory and collaboration.

## Motivation

The 1.x CLI ends at one file per site, holding one baseline and a short history.
Teams eventually need:

- **History:** when did this page start drifting, and which commit did it?
- **Branch baselines:** a feature branch's approvals shouldn't affect main,
  and should carry over when the branch merges.
- **Approval:** an intended change should pass the next run without
  re-snapshotting prod, and targets with no prod (new features, pre-launch sites)
  need a baseline someone accepted. 1.x has no approval at all
  ([ADR-0028](../adr/0028-approval-belongs-to-the-server.md)).
- **Shared review:** a designer approves in a browser, not by running a CLI
  command.
- **Status checks:** a required "momus" check on the PR that goes green when
  the changes are approved.
- **Scale:** images in object storage, not in a growing SQLite file passed
  between CI jobs.

## Proposed shape

- **Ingest.** `momus upload` (or `momus run --upload`) sends the RFC-0008 JSON
  document, plus images addressed by content hash. The server already has most
  images, so uploads are mostly small.
- **Approval.** Approving a capture makes it the baseline; rejecting records
  the decision. Approved baselines don't need a prod at all. Withdrawn
  [RFC-0003](0003-approval-workflow.md) is the starting point for the
  model: per-target provenance, reject versus approve, and `added`/`removed`
  resolved by approval. Approval refuses a capture that fails the baseline
  compatibility gate ([ADR-0010](../adr/0010-baseline-compatibility-gate.md)).
- **Baselines.** One baseline per `(project, branch)`. A new branch inherits
  from its merge base on the default branch; approvals on the branch are applied
  to the default branch when the PR merges.
- **Review UI.** A served version of the review report
  ([RFC-0007](0007-review-report.md)), adding approval in place, comments,
  history per target, and "who approved this."
- **Integrations.** A GitHub App for status checks and PR comments. GitLab
  merge-request status. Webhooks for anything else.
- **Storage.** Postgres for metadata, plus S3-compatible object storage for
  images. A SQLite and local-disk mode for a single-machine install.
- **Deployment.** One Docker image, with a Compose file for the
  Postgres + S3-compatible setup.
- **Auth.** API tokens per project for the CLI; OIDC or GitHub login for people.

## What 1.x must do for this to work

These are commitments in the 1.x RFCs, collected here:

- Runs carry complete provenance and CI metadata
  ([RFC-0002](0002-storage-and-run-history.md)).
- A target has a stable id independent of its URL ([RFC-0001](0001-targets.md)).
- The JSON results document is versioned and contains everything needed for
  history ([RFC-0008](0008-cli-ci-integration.md)).
- Nothing in 1.x presumes a baseline source other than a prod snapshot, so
  the server can introduce approved baselines without a 1.x break
  ([ADR-0028](../adr/0028-approval-belongs-to-the-server.md)).

## Non-goals (for 2.0)

- Running captures on the server. The CLI captures, and the server stores and
  reviews. Server-side capture fleets are a possible 3.0.
- A hosted SaaS. That is a separate decision from the self-hosted server.

## Open questions

- Where does the code live: this repo as a workspace, or a separate
  `momus-server` repository? This affects how the JSON schema is shared.
- Does Bun on the server match the CLI's stack, or does the server pick its own?
- How do branch baselines work across forks and squash merges?
- What is the migration path for a team's existing `.sqlite` history: import,
  or start fresh? [RFC-0009](0009-stability-contract.md) settles that a
  one-time import is acceptable; how the import works is still open.
- Does a CLI-only team get any approval, for example a server-free
  `momus approve` that writes the local `.sqlite`? If so, it must be designed
  alongside the server's model, not before it.
