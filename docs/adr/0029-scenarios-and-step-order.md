# ADR-0029: Scenarios are declarative steps; animations go off before steps, mask and remove after

**Date:** 2026-10-17 · **Status:** Accepted · **Implements:** [RFC-0004](../rfcs/0004-scripted-interactions.md)

## Context

[RFC-0004](../rfcs/0004-scripted-interactions.md) adds scenarios: a path, some
steps, and optionally one element to capture. Steps are stored with the baseline
and compared by the per-target gate ([ADR-0023](0023-per-target-recipe-gate.md)),
so they have to be data. Several details had to be pinned down: what a step
looks like, which element a selector means, when each step times out, and where
steps sit in the capture sequence.

## Decision

**The vocabulary is small and each step is a strict one-key object:** `click`,
`hover`, `fill`, `press`, `select`, `scroll`, `waitFor`, `wait`, `evaluate`. A
typo such as `{ clik: "a" }` is a config error, not a silent no-op. `goto` exists
only in `setup`: a scenario is one page, its `path`, in one state.
`press` takes a key (on the page) or `[selector, key]`.

**Every selector acts on its first match** (`.first()`), including
`capture.element`. Playwright's strict mode would fail on a selector that
matches two elements. For "get this page into a state" that is friction with no
benefit, and one rule everywhere is easier to explain.

**Each step has a timeout of `stabilize.timeoutMs`.** Step indexes in error
messages are 1-based, as people count lines in a config. A failing step, or an
element that matches nothing, is an error row naming the step
([ADR-0006](0006-errors-are-rows.md)). Element capture never falls back to the
full page: a screenshot of the wrong thing passes quietly.

**Steps and the element screenshot each get their own `timeoutMs`.** They sit
outside the shared navigation-plus-settle deadline. So a recipe can take longer
than one `timeoutMs` in total; a slow page load doesn't starve the steps, and
long scenarios aren't starved by early steps.

**Recipes are validated at capture time with `RecipeSchema`.** A recipe stored
in a baseline row is data from an older momus or a hand-edited file. A malformed
one becomes an error row instead of a throw.

**Capture order:**

1. navigate, settle, autoscroll, wait for fonts
2. disable animations
3. run steps
4. apply `mask`, then `remove`
5. settle (`settleMs`)
6. screenshot the page or the element

Animations go off before the steps so a transition a step triggers ends at once
and the shot is stable. `mask` and `remove` go after the steps so steps can still
reach anything, and so whatever a step reveals (a modal, a menu) is masked too.

Page-only captures run the same sequence minus step 3, so their pixels are
unchanged and nothing new joins the global gate for pages
([ADR-0010](0010-baseline-compatibility-gate.md)). Scenario recipes are gated per
target.

## Consequences

- Scenarios ignore `discovery.include`, `exclude` and `maxPages`. A scenario is
  listed on purpose, and a scenario deleted from the config is reported
  `removed` ([ADR-0022](0022-added-and-removed-targets.md)).
- Scenario `fill` values, `goto` URLs, `select` values and `evaluate` scripts are
  stored in `baseline_images.recipe_json`, in the `.sqlite`, as-is. Credentials
  belong in `setup` ([ADR-0030](0030-setup-per-side.md)), never in scenario
  steps. The docs say so.
- `evaluate` is the escape hatch for anything the vocabulary lacks. There are no
  callbacks, conditionals, or loops; a team that wants to reuse steps spreads a
  shared array in its TypeScript config.
