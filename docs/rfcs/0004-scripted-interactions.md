# RFC-0004: Scripted interactions, element capture, and auth

**Status:** Draft · **Milestone:** M3 · **Created:** 2026-10-16

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
- **A setup failure is operational (exit 2)**, not per-target. Without a
  session, every page would just capture the login screen. An honest exit 2 is
  better than 500 identical "passing" screenshots of a login form.
- Secrets come from the environment, as with `requestHeaders`. The saved
  session is never written to the `.sqlite` or the report.

## Non-goals

- Arbitrary TypeScript callbacks as steps. Callbacks can't be stored, compared,
  or shown in a report, and they would make the config a program. `evaluate`
  is the escape hatch.
- Recording steps from a live browser session (codegen). Worth doing later;
  not needed for 1.0.

## Compatibility

- Configs with no `scenarios` or `setup` behave exactly as today.
- `setup` changes what every page renders, so it joins the **global**
  compatibility gate, compared by a hash of the steps. Scenario recipes join the
  per-target gate (RFC-0001). Defaults are `[]` and `undefined`, so old
  baselines stay diffable ([ADR-0010](../adr/0010-baseline-compatibility-gate.md)).

## Open questions

- Should scenarios be able to share a sequence of steps, such as "open the
  cookie dialog"? Fragments add complexity; copying steps is fine until it
  isn't.
- Should prod and dev need different credentials, as with separate staging
  users? Probably yes: allow `setup.dev` and `setup.prod`.

## Done when

- [ ] Scenarios with the full step vocabulary work on all three engines.
- [ ] Element capture works, and a missing element errors per target.
- [ ] Setup logs in once per side; a setup failure exits 2 with the failing
      step named.
- [ ] Recipes and setup are gated for compatibility; old baselines still diff.
- [ ] e2e: a fixture site with a login form and a toggled menu.
