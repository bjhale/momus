# ADR-0024: Versioned schema migrations; a newer DB is refused

**Date:** 2026-10-17 · **Status:** Accepted

## Context

The schema grew through `CREATE TABLE IF NOT EXISTS` on open, one guarded
`ALTER TABLE`, and an in-place rebuild for target keys
([ADR-0021](0021-targets-and-source-provenance.md)). That can't express an
ordered sequence of changes, and it can't tell a user that their `.sqlite` came
from a newer momus — an older binary would open it and write into tables it
doesn't understand. Run history (RFC-0002) needs another rebuild, so the ad hoc
approach had run out.

## Decision

The schema version lives in `PRAGMA user_version`. `src/store/migrations.ts`
holds an ordered list of frozen `(version, up)` steps. `migrate()` runs each
step above the file's version in its own transaction together with its
`user_version` bump, so a failed step leaves the DB at the previous version.

- **v1 is the v0.9.x schema verbatim**, written as `CREATE … IF NOT EXISTS`
  plus the guarded `browser` column. A fresh DB and a pre-versioning DB
  (`user_version` 0) take the same path: on a v0.9.x file every v1 statement is
  a no-op. That is how "detected by its tables, assigned version 1" is realized.
- v2 is the target-key rebuild; v3 is run history
  ([ADR-0025](0025-run-history.md)).
- A step that rebuilds BLOB-bearing tables sets `vacuum: true`. VACUUM can't run
  in a transaction, so it runs once after the last step commits, and switches the
  file to `auto_vacuum = INCREMENTAL` on the way.
- **A newer DB is refused.** `openDb` first opens the file read-only and checks
  `user_version`; only then does it open read-write. The probe exists because
  even switching on WAL rewrites the header. `DbTooNewError` names both versions;
  the commands print `Database error: …` and exit 2.

Rejected: create the latest schema directly for fresh DBs and keep migrations
for old ones. Two sources of truth for the same shape drift apart, and the
fresh-DB path would be the one every test exercises.

## Consequences

- **Never edit a released step.** A user's DB may have stopped at any version.
  For the same reason v2's table shapes are their own constants, not shared
  with later code.
- `tests/fixtures/db/v0.9.4.sqlite` was written by the real v0.9.4 CLI
  (`tests/fixtures/db/make-v0.9.4.ts`) and is checked in under a narrow
  `.gitignore` negation. Every migration must open it and keep its baseline
  diffable. Never regenerate it with a newer momus.
- Releases before this one predate the check, so they won't refuse a migrated
  DB. The protection only works forward from here.
