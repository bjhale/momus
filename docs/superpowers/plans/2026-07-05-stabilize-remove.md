# `stabilize.remove` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `stabilize.remove` config option — a list of CSS selectors whose matching elements are removed from the DOM (`element.remove()`) before each screenshot, so their layout space collapses (unlike `mask`, which only hides).

**Architecture:** Mirror `mask`. Add `remove` to the config schema and the `StabilizeOptions` type; add a `removeSelectors(page, selectors)` helper that `page.evaluate`s `element.remove()` (skipping invalid selectors); call it in `capture()` after CSS injection and before the settle wait. Add `remove` to the baseline-compat check (with backward-compat for pre-existing baselines).

**Tech Stack:** Bun, TypeScript, Zod, Playwright (playwright-core), `bun:test`. No new dependencies.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- Field name is **`remove`**, under `stabilize`, beside `mask`: `z.array(z.string()).default([])`.
- `removeSelectors` performs **true DOM removal** (`element.remove()`), not CSS. An **invalid selector is caught per-selector and skipped** — never aborts the capture. An empty list is a no-op.
- In `capture()`, removal runs **after** the mask/animation CSS `addStyleTag` and **before** the `settleMs` wait (so reflow settles), then the screenshot.
- `StabilizeOptions` gains `remove: string[]` (**required** — the schema always fills the `[]` default, so `ResolvedConfig.stabilize` always carries it; hand-built `StabilizeOptions` literals in tests must add `remove: []`).
- `baselineConflict` adds a field-by-field `remove` check (length + element-wise), naming the field on mismatch, and treats a snapshot missing `remove` as `[]` (`ss.remove ?? []`) for backward compatibility.
- `capture()` still never throws for one bad page.
- Commit after each task.

---

## File Structure

- `src/config/schema.ts` — **modify**: add `remove` to `stabilize`.
- `src/capture/screenshot.ts` — **modify**: `StabilizeOptions.remove`; add + export `removeSelectors`; call it in `capture()`.
- `src/pipeline/compat.ts` — **modify**: add the `remove` conflict check.
- `src/commands/init.ts`, `README.md` — **modify**: document `remove`.
- Tests: `tests/config/schema.test.ts`, `tests/capture/remove.test.ts` (new, browser-guarded), `tests/pipeline/compat.test.ts`, plus `remove: []` added to `StabilizeOptions` literals in `tests/capture/screenshot.test.ts`, `tests/capture/screenshot.integration.test.ts`, `tests/store/db.test.ts`.

---

## Task 1: Schema + `StabilizeOptions` + `removeSelectors` + capture wiring

**Files:**
- Modify: `src/config/schema.ts`, `src/capture/screenshot.ts`, `tests/capture/screenshot.test.ts`, `tests/capture/screenshot.integration.test.ts`, `tests/store/db.test.ts`
- Test: `tests/config/schema.test.ts`, `tests/capture/remove.test.ts` (new)

**Interfaces:**
- Produces:
  - `ResolvedConfig.stabilize.remove: string[]` (default `[]`).
  - `StabilizeOptions.remove: string[]` (required).
  - `removeSelectors(page: Page, selectors: string[]): Promise<void>` (exported from `src/capture/screenshot.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/schema.test.ts`:

```typescript
test("stabilize.remove defaults to [] and accepts selectors", () => {
  const d = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(d.stabilize.remove).toEqual([]);
  const r = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", stabilize: { remove: [".x", "#y"] } });
  expect(r.stabilize.remove).toEqual([".x", "#y"]);
});
```

Create `tests/capture/remove.test.ts`:

```typescript
// tests/capture/remove.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled, launchBrowser } from "../../src/capture/browser";
import { removeSelectors } from "../../src/capture/screenshot";

const maybe = isBrowserInstalled() ? test : test.skip;

maybe("removes matching elements from the DOM, keeps others", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="remove-me">x</div><div class="keep">y</div>`);
    await removeSelectors(page, [".remove-me"]);
    expect(await page.$(".remove-me")).toBeNull();
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});

maybe("an invalid selector does not throw and leaves the DOM intact", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="keep">y</div>`);
    await removeSelectors(page, ["::::"]); // invalid → skipped, not fatal
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});

maybe("empty selector list is a no-op", async () => {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<div class="keep">y</div>`);
    await removeSelectors(page, []);
    expect(await page.$(".keep")).not.toBeNull();
    await ctx.close();
  } finally {
    await browser.close();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/config/schema.test.ts tests/capture/remove.test.ts`
Expected: FAIL — `stabilize.remove` is stripped/undefined; `removeSelectors` is not exported. (The `remove.test.ts` cases run only if Chromium is installed; otherwise they skip — either way the import of `removeSelectors` fails to resolve until Step 4.)

- [ ] **Step 3: Add `remove` to the schema**

In `src/config/schema.ts`, add the field to the `stabilize` object, right after the `mask` line:

```typescript
    remove: z.array(z.string()).default([]),
```

- [ ] **Step 4: Add `removeSelectors` + wire it into `capture()` in `src/capture/screenshot.ts`**

Add `Page` to the playwright-core type import:

```typescript
import type { Browser, BrowserContext, Page } from "playwright-core";
```

Add `remove` to `StabilizeOptions` (after `mask`):

```typescript
  remove: string[];
```

Add the exported helper (place it above `capture`):

```typescript
/** Remove every element matching `selectors` from the DOM before capture, so
 * their layout space collapses (unlike `mask`, which only hides). Invalid
 * selectors are skipped, never aborting the capture. */
export async function removeSelectors(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.evaluate((sels) => {
    for (const sel of sels) {
      try {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      } catch {
        /* ignore an invalid selector rather than aborting the capture */
      }
    }
  }, selectors);
}
```

In `capture()`, insert the removal call between the `addStyleTag` line and the `settleMs` wait:

```typescript
    if (css) await page.addStyleTag({ content: css });
    await removeSelectors(page, opts.remove);
    if (opts.settleMs > 0) await page.waitForTimeout(opts.settleMs);
```

- [ ] **Step 5: Add `remove: []` to the hand-built `StabilizeOptions` literals**

- `tests/capture/screenshot.test.ts`: change the `STAB` constant to include `remove: []`:

```typescript
const STAB = { waitUntil: "load" as const, settleMs: 0, timeoutMs: 1000, disableAnimations: true, mask: [], remove: [] };
```

- `tests/capture/screenshot.integration.test.ts`: in each of the three inline `capture(browser, url, …, { … })` stabilize objects, add `remove: []` to the line that has `disableAnimations: true, mask: [],`:

```typescript
      disableAnimations: true, mask: [], remove: [],
```

- `tests/store/db.test.ts`: change the `STAB` constant to include `remove: []`:

```typescript
const STAB = {
  waitUntil: "networkidle" as const, settleMs: 500, timeoutMs: 15000,
  disableAnimations: true, mask: [".ad"], remove: [],
};
```

- [ ] **Step 6: Run to verify they pass**

Run: `bun test tests/config/schema.test.ts tests/capture/remove.test.ts && bunx tsc --noEmit`
Expected: PASS (schema test; the browser-guarded `removeSelectors` tests pass if Chromium is present, else skip), no type errors.

- [ ] **Step 7: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors. (The literal updates keep every `StabilizeOptions`/`SnapshotMeta.stabilize` construction well-typed.)

- [ ] **Step 8: Commit**

```bash
git add src/config/schema.ts src/capture/screenshot.ts tests/config/schema.test.ts tests/capture/remove.test.ts tests/capture/screenshot.test.ts tests/capture/screenshot.integration.test.ts tests/store/db.test.ts
git commit -m "feat: add stabilize.remove — delete elements from the DOM before capture"
```

---

## Task 2: Baseline compatibility check for `remove`

**Files:**
- Modify: `src/pipeline/compat.ts`
- Test: `tests/pipeline/compat.test.ts`

**Interfaces:**
- Consumes: `ResolvedConfig.stabilize.remove` + `SnapshotMeta.stabilize.remove` (Task 1).
- Produces: `baselineConflict` returns a `stabilize.remove differs…` reason when the two `remove` arrays differ; treats a snapshot missing `remove` as `[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pipeline/compat.test.ts`:

```typescript
test("differing stabilize.remove → conflict naming remove", () => {
  const c = cfg({ stabilize: { remove: [".new"] } });
  const snap = snapFrom(cfg({ stabilize: { remove: [".old"] } }));
  const msg = baselineConflict(c, snap);
  expect(msg).not.toBeNull();
  expect(msg!.toLowerCase()).toContain("remove");
});

test("a baseline snapshot missing 'remove' does not conflict with a default (empty) config remove", () => {
  const c = cfg(); // remove defaults to []
  const snap = snapFrom(cfg());
  // Simulate a baseline snapshotted before this feature: its stored stabilize
  // has no `remove` key.
  delete (snap.stabilize as { remove?: string[] }).remove;
  expect(baselineConflict(c, snap)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/pipeline/compat.test.ts`
Expected: FAIL — the differing-`remove` test gets `null` (no check yet), so the `expect(msg).not.toBeNull()` fails.

- [ ] **Step 3: Add the `remove` check to `src/pipeline/compat.ts`**

In `baselineConflict`, after the `stabilize.mask` check and before `return null;`, add:

```typescript
  const cr = cs.remove ?? [], sr = ss.remove ?? [];
  if (cr.length !== sr.length || cr.some((m, i) => m !== sr[i])) {
    return `stabilize.remove differs: config ${JSON.stringify(cr)} vs baseline ${JSON.stringify(sr)}`;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/pipeline/compat.test.ts && bunx tsc --noEmit`
Expected: PASS (the new tests plus all pre-existing compat tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/compat.ts tests/pipeline/compat.test.ts
git commit -m "feat: include stabilize.remove in the baseline conflict check"
```

---

## Task 3: Docs + scaffold

**Files:**
- Modify: `src/commands/init.ts`, `README.md`

**Interfaces:** none (docs/scaffold only).

- [ ] **Step 1: Update the `init` scaffold**

In `src/commands/init.ts`, in the `stabilize` block of the `configScaffold()` template string, add a commented `remove` line right after the `mask:` line:

```typescript
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],
    // remove: [".cookie-banner"],   // delete elements from the DOM before capture (space collapses)
```

- [ ] **Step 2: Update the README config example**

In `README.md`, in the `stabilize` block of the `## Configuration` example, add a `remove` line right after the `mask:` line:

```markdown
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],  // hide dynamic regions
    remove: [".cookie-banner"],                           // delete elements (space collapses)
```

- [ ] **Step 3: Update the mask note**

In `README.md`, find the `- **\`mask\`** selectors are hidden before capture …` bullet in the config "Notes:" list and replace it with:

```markdown
- **`mask`** selectors are hidden before capture (via `visibility: hidden`, so
  they keep their layout space) — for inherently dynamic regions (carousels, ads,
  timestamps) that shouldn't produce false diffs. **`remove`** selectors are
  instead deleted from the DOM before capture, so the page reflows and their space
  collapses — for elements like cookie banners or chat widgets that shift layout.
```

- [ ] **Step 4: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS (docs/scaffold change touches no asserted runtime behavior; the scaffold string is not snapshot-tested).

```bash
git add src/commands/init.ts README.md
git commit -m "docs: document stabilize.remove"
```

---

## Self-Review

**1. Spec coverage:**
- §1 config + type (`stabilize.remove` schema default `[]`; `StabilizeOptions.remove`) → Task 1. ✓
- §2 capture step (`removeSelectors`, ordering after CSS/before settle, invalid-selector skip) → Task 1. ✓
- §3 baseline compat (`remove` field check + `?? []` backward-compat) → Task 2. ✓
- §4 docs + scaffold → Task 3. ✓
- §5 edge cases (empty no-op, invalid skip, both sides) → Task 1 tests + capture wiring (both dev/prod use `capture`, so `remove` applies to both). ✓
- §6 testing (schema default/accept; compat differ + missing-remove; removeSelectors DOM removal/invalid/empty; STAB literals) → Tasks 1–2. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code.

**3. Type consistency:** `StabilizeOptions.remove: string[]` (Task 1) matches `ResolvedConfig.stabilize.remove` (schema default `[]`), so `capture(browser, url, vw, cfg.stabilize)` still typechecks in the commands. `removeSelectors(page: Page, selectors: string[])` (Task 1) is imported by `remove.test.ts` and called in `capture()` with `opts.remove`. `baselineConflict` reads `cs.remove`/`ss.remove` (both `string[]` per the shared `StabilizeOptions`/`SnapshotMeta.stabilize` type) with `?? []` guarding the old-baseline runtime case (Task 2). Every hand-built `StabilizeOptions` literal gets `remove: []` (Task 1 Step 5). ✓

**Note for the implementer:** `removeSelectors`'s real DOM behaviour is covered by the browser-guarded `remove.test.ts` (runs when Chromium is installed). The capture-flow ordering (CSS → remove → settle → screenshot) is exercised by the existing browser-guarded capture/e2e tests; do not add a PNG-diff assertion for removal (asserting removed pixels from a screenshot is brittle — the DOM assertion in `remove.test.ts` is the authoritative check).
