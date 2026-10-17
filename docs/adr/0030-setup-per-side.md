# ADR-0030: Setup runs once per side; prod logs in only when a baseline is captured; only prod's redacted setup is gated

**Date:** 2026-10-17 · **Status:** Accepted · **Implements:** [RFC-0004](../rfcs/0004-scripted-interactions.md)

## Context

Most real sites sit behind a login, and `requestHeaders` covers only proxies.
Dev and prod often need different logins, so setup has to work per side. Setup
also touches three standing rules: the baseline is frozen and prod is not
touched on a normal run ([ADR-0011](0011-run-always-diffs-a-baseline.md)),
anything that changes captured pixels joins the compatibility gate
([ADR-0010](0010-baseline-compatibility-gate.md)), and the `.sqlite` is often
committed, so it must never hold a credential.

## Decision

**Setup runs once per side, in its own browser context, before any capture.**
Its cookies and storage are loaded into every capture context for that side.
`setup` is either one shared form (`steps` or `storageState`) or `{ dev, prod }`,
never a mix, and a per-side form must name both sides. The schema normalizes
both to `{ dev, prod }`, so nothing downstream sees two shapes.

**The seams are `setupDev` and `setupProd`**, built in
`src/commands/capture-seams.ts`. Prod setup runs only when a baseline is about to
be captured: a first `run`, `run --snapshot`, or `snapshot`. A run against a
frozen baseline never logs in to prod, because it never touches prod. Prod setup
runs before the baseline capture; dev setup runs before the dev captures.

**A setup failure is operational.** `SetupError` exits 2 and names the side and
the step, for example `setup (prod) step 3: fill "#password"`. Without a session
every page would capture the login screen, and a run of identical passing login
forms is worse than an honest failure. The message never carries a `fill` value.

**Sessions live in memory only.** They are never written to the `.sqlite` or the
report.

**A `storageState` file is validated once, at setup.** It must be JSON with
`cookies` and `origins` arrays. A parse failure reports "not valid JSON" and
does not echo the file, since a parser error can quote a token and the file holds
session secrets. One bad file then fails setup once (exit 2) instead of erroring
every capture.

**The gate compares prod's redacted setup as canonical JSON**, stored in
`snapshot.setup_json` (migration v4, NULL = no setup). Only prod's setup is
compared: the baseline is a prod capture, so prod's setup shaped its pixels, as
with the prod origin ([ADR-0026](0026-prod-origin-in-the-gate.md)). Changing dev
setup doesn't make a baseline undiffable. In the shared form the shared setup is
the prod setup.

Redacted JSON rather than a hash, because it is readable ("prod setup differs")
and because neither a secret nor a hash of one is stored. `fill` values and the
`storageState` path become `[redacted]`; selectors, step order and other values
stay. `redactConfig` is applied to every stored config (`runs.config_json`,
`snapshot.config_json`) and to `config_hash`.

## Consequences

- Rotating a password doesn't invalidate the baseline. Switching prod to a
  different user isn't caught by the gate; re-snapshot when you do.
- Different users can render different personalized content (a name in the
  header). That is a diff, and `mask` is the tool for it.
- If dev setup fails after a baseline was materialized in the same run, the new
  baseline stays committed and no run is recorded. That is intended: the
  baseline is valid, and the failure is operational.
- Known limitation, not fixed here: `requestHeaders` values are still stored in
  `config_json`. That predates this work, and a proxy token in a committed
  `.sqlite` deserves its own decision.
- The old baselines (NULL `setup_json`) stay diffable against a config without
  setup, per ADR-0010.
