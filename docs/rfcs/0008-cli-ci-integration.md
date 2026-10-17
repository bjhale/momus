# RFC-0008: CLI CI integration

**Status:** Draft · **Milestone:** M6 · **Created:** 2026-10-16

## Summary

Make momus a first-class CI citizen without a server. That means
machine-readable results, an official GitHub Action, a pull request summary,
and a way to split large runs across machines. The JSON results format is
designed from the start to be what the 2.0 server ingests.

## Motivation

Exit codes and an HTML artifact are the minimum. In CI, teams want to see the
outcome *in the pull request*. They want test dashboards that understand it
(JUnit). They want a large site to finish in reasonable time, and a CI setup
that doesn't take an afternoon to work out.

## Today

- Exit codes 0, 1 and 2 ([ADR-0006](../adr/0006-errors-are-rows.md)), an HTML
  report, and the `.sqlite` as an artifact.
- Progress goes to stderr; stdout carries one summary line
  ([ADR-0018](../adr/0018-progress-behind-a-seam.md)).

## Proposal

### Machine-readable output

- `--json FILE` writes the results document: run provenance, baseline identity,
  and for each comparison the target, viewport, status, score, the gate that
  applied, and image references. It is versioned with
  `"schemaVersion": 1`, and is published as a JSON Schema in the repo.
- `--junit FILE` writes one testcase per `(target, viewport)`, with failures and
  errors in the standard JUnit fields.
- `--summary FILE` writes a Markdown summary: the verdict, counts, and the worst
  N comparisons with their scores. It is suitable for `$GITHUB_STEP_SUMMARY` or
  a PR comment.

### CI metadata

Read the commit, branch, PR number, and CI run URL from flags
(`--commit`, `--branch`, `--pr`) or from well-known environment variables
(GitHub Actions and GitLab CI to start). Store them on the run
([RFC-0002](0002-storage-and-run-history.md)) and include them in the JSON.

### The GitHub Action

`bjhale/momus-action`, a thin wrapper that runs the published image. It:

- restores and saves the `.sqlite` baseline through `actions/cache` or an
  artifact,
- runs `momus run` with `--json`, `--junit` and `--summary`,
- uploads the report as an artifact,
- writes the step summary, and optionally posts or updates a single PR comment.

Documented recipes cover "nightly prod snapshot plus a PR diff" and GitLab
CI.

### Sharding

`--shard i/n` captures a deterministic slice of the targets, chosen by a stable
hash of the target id. `momus merge a.sqlite b.sqlite … --into run.sqlite`
combines the slices into one run and one report. The baseline must be identical
across shards, and merge refuses otherwise.

### Server-ready checklist

- [ ] Can the JSON document be POSTed as-is to the 2.0 server, with images sent
      separately and addressed by content hash?
- [ ] Is every field the server needs for history (target id, provenance,
      baseline identity) present without parsing the HTML or the config?

## Non-goals

- Commit status checks or GitHub App installations. Those need a long-lived
  service and belong to 2.0 ([RFC-0010](0010-server.md)).
- Official integrations beyond GitHub Actions. GitLab and others get documented
  recipes, not maintained plugins.

## Compatibility

Additive flags. The JSON schema and the JUnit mapping become part of the 1.0
contract ([RFC-0009](0009-stability-contract.md)).

## Open questions

- Should the Action live in this repo (under `action/`) or in its own? A
  separate repo is the GitHub Marketplace convention, but it splits releases.
- Should an image in the JSON be a path, a content hash, or both?

## Done when

- [ ] `--json` (with its schema published), `--junit` and `--summary` work.
- [ ] CI metadata is detected on GitHub Actions and GitLab CI.
- [ ] The Action is published, with a working example repo.
- [ ] `--shard` plus `merge` produce a report identical to an unsharded run.
- [ ] The server-ready checklist is satisfied.
