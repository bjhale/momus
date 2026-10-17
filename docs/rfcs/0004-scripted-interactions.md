# RFC-0004: Scripted interactions, element capture, and auth

**Status:** Implemented · **Milestone:** M3 · **Created:** 2026-10-16

## Summary

Let a target carry a **recipe**: steps to perform before capture, and
optionally an element to capture instead of the full page. Add a run-level
**setup** phase that logs in once and reuses the session for every capture.

## Motivation

- **Pages only render one state.** Menus, modals, validation errors, hover
  states and tabs are where regressions hide, and none of them render on load.
- **Full pages are noisy.** A team that owns a header wants to gate on the
  header, not on a news feed below it.
- **Most real apps sit behind a login.** `requestHeaders` covers proxies such
  as Cloudflare Access. It doesn't cover a session cookie from a login form.

## Today

- Capture navigates, stabilizes, and screenshots the full page
  ([screenshot.ts](../../src/capture/screenshot.ts),
  [stabilize.ts](../../src/capture/stabilize.ts)). `mask` and `remove` are the
  only per-page changes, and they apply to every page.
- `requestHeaders` is the only auth mechanism.

## Proposal

### Scenarios

```ts
scenarios: [
  {
    id: "nav-open",
    path: "/",
    steps: [
      { click: "button[aria-label=Menu]" },
      { waitFor: "nav[data-open]" },
    ],
    capture: { element: "nav" },          // optional; default full page
    viewports: [375],                     // optional narrowing (RFC-0001)
  },
  {
    id: "signup-errors",
    path: "/signup",
    steps: [{ click: "button[type=submit]" }, { waitFor: ".field-error" }],
  },
],
```

- Each scenario is a target from the `scenarios` source, with id `scenarios:<id>`
  ([RFC-0001](0001-targets.md)), run identically on dev and prod.
- **The step vocabulary is deliberately small and declarative:** `click`,
  `hover`, `fill`, `press`, `select`, `scroll`, `waitFor` (a selector or a
  hidden selector), `wait` (ms; discouraged, but sometimes necessary), and
  `evaluate` (a string of page JavaScript).
- Steps are data, so they can be stored with the baseline and compared by
  the per-target compatibility gate.
- Selectors use Playwright locator syntax, so `text=` and `role=` work.
- **A failing step is a per-target error row** that names the step index and
  selector ([ADR-0006](../adr/0006-errors-are-rows.md)). It never aborts the run.

### Element capture

`capture.element` screenshots the bounding box of the first matching element. If
nothing matches, the target errors; it doesn't fall back to the full page.
`mask` and `remove` still apply.

### Setup and auth

```ts
setup: {
  steps: [
    { goto: "/login" },
    { fill: ["#email", Bun.env.MOMUS_USER] },
    { fill: ["#password", Bun.env.MOMUS_PASS] },
    { click: "button[type=submit]" },
    { waitFor: "[data-user-menu]" },
  ],
  // or: storageState: "auth.json"   // a pre-made Playwright login session file
},
```

- Setup runs **once per side** (dev, prod), in its own browser context, before
  any capture. The resulting cookies and storage are saved and loaded into every
  capture context for that side.
- `goto` is relative to each side's base URL, so one set of steps logs in to
  both when only the hosts differ.
- **A setup failure is operational (exit 2)**, not per-target. Without a
  session, every page would just capture the login screen. An honest exit 2 is
  better than 500 identical "passing" screenshots of a login form.
- Secrets come from the environment, as with `requestHeaders`. The saved
  session is never written to the `.sqlite` or the report.

#### Separate setup for dev and prod

Dev and prod often need different logins: a staging user versus a production
user, a different identity provider, or an SSO page on prod that dev doesn't
have. So `setup` takes either one setup shared by both sides (above) or one per
side:

```ts
setup: {
  dev: {
    steps: [
      { goto: "/login" },
      { fill: ["#email", Bun.env.MOMUS_DEV_USER] },
      { fill: ["#password", Bun.env.MOMUS_DEV_PASS] },
      { click: "button[type=submit]" },
      { waitFor: "[data-user-menu]" },
    ],
  },
  prod: { storageState: "prod-auth.json" },
},
```

- Each side is `{ steps }` or `{ storageState }`, chosen independently. The
  steps can differ completely, not only the credentials.
- The two forms don't mix. A `setup` that has `dev` or `prod` keys can't also
  have top-level `steps` or `storageState`, so there's never a question of which
  one wins. A per-side `setup` must define both sides. The shared form is
  already the way to say "same on both," and an accidental logged-out side would
  capture a login screen.
- A setup failure names the side and the failing step, for example
  `setup (prod) step 3: fill "#password"`, and exits 2 as above.
- Different users can render different personalized content, such as a name in
  the header. That shows up as a diff. `mask` is the tool for it, and the docs
  should say so next to this example.

## Non-goals

- Arbitrary TypeScript callbacks as steps. Callbacks can't be stored, compared,
  or shown in a report, and they would make the config a program. `evaluate`
  is the escape hatch.
- Recording steps from a live browser session (codegen). Worth doing later;
  not needed for 1.0.
- Step fragments, shared sequences, conditionals, or loops. momus is not a
  browser automation platform. A scenario is a short, flat list of steps that
  puts one page in one state. A scenario that needs more is a sign it belongs
  in an end-to-end test suite. The config file is TypeScript, so a team that
  wants to reuse steps can spread a shared array (`steps: [...openCookieDialog,
…]`) without momus knowing.

## Compatibility

- Configs with no `scenarios` or `setup` behave exactly as today.
- `setup` changes what every page renders, so it joins the **global**
  compatibility gate, compared by a hash of the steps. Scenario recipes join the
  per-target gate (RFC-0001). Defaults are `[]` and `undefined`, so old
  baselines stay diffable ([ADR-0010](../adr/0010-baseline-compatibility-gate.md)).
- **Only the prod side's setup is gated.** The baseline is a prod capture, so the
  prod setup is what shaped its pixels, as with the prod origin
  ([ADR-0026](../adr/0026-prod-origin-in-the-gate.md)). Changing the dev setup
  doesn't make the baseline undiffable. In the shared form, the shared setup is
  the prod setup.
- **The hash never covers secrets.** `fill` values and `storageState` contents
  are left out of the hash and only their presence is recorded, while the
  selectors, step order, and other values are hashed. Rotating a password then
  doesn't invalidate the baseline, and the `.sqlite`, which teams commit,
  never holds a hash of a credential. The cost is that switching prod to a
  different user isn't caught by the gate; re-snapshot when you do.

## Open questions

None.

## Done when

- [x] Scenarios with the full step vocabulary work on all three engines.
- [x] Element capture works, and a missing element errors per target.
- [x] Setup logs in once per side; a setup failure exits 2 with the side and
      failing step named.
- [x] Per-side `setup.dev` / `setup.prod` work, including steps on one side and
      `storageState` on the other; mixing shared and per-side keys, or defining
      only one side, is a config error.
- [x] Only the prod setup is gated, and the gate hash excludes `fill` values
      and `storageState` contents.
- [x] Recipes and setup are gated for compatibility; old baselines still diff.
- [x] e2e: a fixture site with a login form and a toggled menu, logged in
      with different credentials on dev and prod.

## Revisions

- **2026-10-17: implemented** ([ADR-0029](../adr/0029-scenarios-and-step-order.md),
  [ADR-0030](../adr/0030-setup-per-side.md)).
- Setup's identity in the gate is **redacted canonical JSON**
  (`snapshot.setup_json`), not a hash of the steps. It is readable, and neither a
  secret nor a hash of one is stored. The no-secrets rule is unchanged.
- `press` takes a key (on the page) or `[selector, key]`.
- Selectors act on the **first** match, `capture.element` included.
- Steps and the element screenshot each get their own `stabilize.timeoutMs`.
