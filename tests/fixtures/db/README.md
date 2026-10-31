# Fixture databases

`v0.9.4.sqlite` was written by the real momus v0.9.4 CLI (`snapshot`, then
`run`) against two tiny local sites. It is the RFC-0002 compatibility fixture:
every schema migration must open it and keep its baseline diffable. Never
regenerate it with a newer momus; that would defeat the point.

To reproduce it, see the header of `make-v0.9.4.ts`.

## Adding a fixture

Every 1.x minor release adds one (CONTRIBUTING.md, "Releasing"):

1. With the **released** build, run `momus snapshot` and then `momus run`
   against two tiny sites, as `make-v0.9.4.ts` does.
2. Check in the DB as `vX.Y.Z.sqlite` and the config it was captured with as
   `vX.Y.Z.config.json` (JSON, no credentials).

`tests/store/fixtures.test.ts` picks up every `v*.sqlite` here: it migrates a
copy and diffs the baseline against itself, which must pass with exit code 0.
A fixture without its `.config.json` fails that test.
