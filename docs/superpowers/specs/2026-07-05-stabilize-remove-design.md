# Design: `stabilize.remove` — delete elements before capture

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Problem

`stabilize.mask` hides dynamic regions before a screenshot via
`visibility: hidden` — the element is invisible but **keeps its layout box**, so
the space it occupies is unchanged. Some elements (cookie banners, floating chat
widgets, promo bars) should instead be **removed entirely** so the page reflows
and their space collapses. We want a `stabilize.remove` option that deletes
matching elements from the DOM before capture.

Decision (from brainstorming): the field is named **`remove`** (mirrors `mask`
and the DOM `element.remove()` it performs). It performs **true DOM removal**
(`element.remove()`), not a CSS `display:none` trick — removal is unconditional
(no element's own `!important` can win a specificity fight) and matches the user's
explicit "remove from the DOM" intent.

## 1. Config + type

- Schema (`src/config/schema.ts`), inside `stabilize`, beside `mask`:
  `remove: z.array(z.string()).default([])`.
- `StabilizeOptions` (`src/capture/screenshot.ts`) gains `remove: string[]`
  (required — the schema always fills the `[]` default, so `ResolvedConfig`
  always carries it).

## 2. Capture step — `removeSelectors`

A new exported helper in `src/capture/screenshot.ts`:

```ts
export async function removeSelectors(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.evaluate((sels) => {
    for (const sel of sels) {
      try { document.querySelectorAll(sel).forEach((el) => el.remove()); }
      catch { /* ignore an invalid selector rather than aborting the capture */ }
    }
  }, selectors);
}
```

`capture()` runs it **after** the mask/animation CSS is injected and **before**
the settle wait, so removal-triggered reflow settles before the shot:

```
addStyleTag(disableAnimations + maskCss)
  → removeSelectors(page, opts.remove)
  → wait settleMs
  → screenshot
```

- Injecting `disableAnimations` CSS first freezes any transition a reflow might
  trigger.
- `mask` and `remove` are independent selector lists targeting different
  elements; order between them is immaterial.
- An **invalid selector** (e.g. a typo that makes `querySelectorAll` throw) is
  caught per-selector inside the page function and skipped — a bad selector never
  aborts the capture (upholds "one bad page can't abort a run"). A selector that
  simply matches nothing is a silent no-op, as expected.

## 3. Baseline compatibility

`remove` changes the captured pixels, so a stored prod baseline is only reusable
when the dev run's `remove` matches. `baselineConflict`
(`src/pipeline/compat.ts`) adds `remove` to its field-by-field `stabilize`
comparison (length + element-wise equality), naming the field on mismatch —
identical treatment to `mask`.

**Backward compatibility:** baselines snapshotted before this feature have a
stored `stabilize_json` with no `remove` key, so `snapshot.stabilize.remove` is
`undefined` at runtime. The conflict check compares `config.stabilize.remove`
(always present, default `[]`) against `snapshot.stabilize.remove ?? []`, so an
existing baseline does **not** spuriously conflict when the live config uses the
default empty `remove`.

## 4. Docs + scaffold

- README config example: add `remove: []` to the `stabilize` block; the existing
  `mask` note gains a `remove` sibling — `mask` hides but keeps the element's
  space; `remove` deletes the element so the page reflows.
- `init` scaffold (`src/commands/init.ts`): add a commented `// remove: [".cookie-banner"],`
  line in the `stabilize` block.

## 5. Edge cases

- Empty `remove` (default) → `removeSelectors` returns immediately; behavior
  identical to today.
- Invalid selector → skipped, capture proceeds.
- Selector matches nothing → no-op.
- `remove` applies to **both** dev and prod captures (it's part of `stabilize`,
  used by every `capture()` call), so both sides reflow identically — keeping the
  diff meaningful.

## 6. Testing

- **schema** (`tests/config/schema.test.ts`): `stabilize.remove` defaults to `[]`;
  a config with `remove: [".x"]` parses through.
- **`baselineConflict`** (`tests/pipeline/compat.test.ts`): differing `remove`
  arrays → conflict whose message names `remove`; a snapshot whose `stabilize`
  omits `remove` vs a config `remove: []` → **no** conflict (backward compat).
- **`removeSelectors`** (`tests/capture/remove.test.ts`, browser-guarded via
  `isBrowserInstalled() ? test : test.skip`): `page.setContent` with a
  `.remove-me` and a `.keep` element → `removeSelectors(page, [".remove-me"])` →
  assert `document.querySelector(".remove-me")` is `null` and `.keep` still
  present; a call with an invalid selector (`"::::"`) does not throw and leaves
  the DOM intact.
- **StabilizeOptions literals**: the inline `STAB` objects in
  `tests/capture/screenshot.test.ts` and `tests/pipeline/compat.test.ts` gain
  `remove: []` (they build `StabilizeOptions`/stabilize objects by hand).
- Existing capture/e2e tests build stabilize via `ConfigSchema.parse`, which
  fills `remove: []` — no change needed there.

## Out of scope

- A CLI flag for `remove` (config only; matches `mask`, which has no flag).
- Per-side (dev-only / prod-only) removal.
- Removing by anything other than CSS selectors (no XPath, text match, etc.).
