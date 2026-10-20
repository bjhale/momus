// src/capture/screenshot.ts
import type { Browser, BrowserContext, Page } from "playwright-core";
import { newContext, type StorageState } from "./browser";
import { runSteps } from "./steps";
import { disableAnimationsCss, maskCss } from "./stabilize";
import { RecipeSchema, type CaptureRecipe } from "../config/schema";
import type { Recipe } from "../targets/target";
import type { CaptureResult } from "../types";

export interface StabilizeOptions {
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  settleMs: number;
  timeoutMs: number;
  disableAnimations: boolean;
  mask: string[];
  remove: string[];
  // RFC-0006. Optional because a baseline from before it has none of them;
  // the gate reads each absence as the behavior that baseline was captured with.
  waitForImages?: boolean;
  /** ISO date that `Date` is pinned to; unset = the real clock. */
  clock?: string;
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark" | "no-preference";
  /** Capture each baseline image twice (snapshot only). Not a capture setting. */
  verify?: boolean;
}

/** Remove every element matching `selectors` from the DOM before capture, so
 * their layout space collapses (unlike `mask`, which only hides). Searches the
 * document AND every open shadow root (so web-component / portal UI like the
 * Next.js dev indicator, which lives in a shadow root, is reachable —
 * `document.querySelectorAll` alone does not pierce shadow DOM). Invalid
 * selectors are skipped, never aborting the capture. Closed shadow roots are
 * unreachable by any script and are left as-is. */
export async function removeSelectors(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.evaluate((sels) => {
    // Collect the document plus every open shadow root, recursively.
    const roots: (Document | ShadowRoot)[] = [];
    const collect = (root: Document | ShadowRoot) => {
      roots.push(root);
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) collect(el.shadowRoot);
      });
    };
    collect(document);

    for (const sel of sels) {
      for (const root of roots) {
        try {
          root.querySelectorAll(sel).forEach((el) => el.remove());
        } catch {
          /* ignore an invalid selector rather than aborting the capture */
        }
      }
    }
  }, selectors);
}

/** Scroll the page top-to-bottom in steps, pausing so lazy content triggers —
 * IntersectionObserver-based lazy loading only fires when elements enter the
 * viewport, and neither a static load nor a full-page screenshot scrolls — then
 * return to the top. Bounded by `maxMs` so infinite-scroll pages can't hang the
 * capture: counted in ~100 ms steps, not by `Date.now()`, which
 * `stabilize.clock` freezes. `scroll-behavior` is forced to `auto` so a site's
 * smooth-scroll CSS doesn't turn each step into a slow animation. */
export async function autoScroll(page: Page, maxMs: number): Promise<void> {
  await page.evaluate(async (budget) => {
    const doc = document.documentElement;
    const prevBehavior = doc.style.scrollBehavior;
    doc.style.scrollBehavior = "auto";
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let prevY = -1;
    for (let step = Math.ceil(budget / 100); step > 0; step--) {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.8));
      await sleep(100);
      const y = window.scrollY;
      if (y === prevY) break; // can't advance further (bottom or stuck)
      prevY = y;
      if (y + window.innerHeight >= doc.scrollHeight) {
        await sleep(150); // let the last viewport's lazy content start loading
        break;
      }
    }
    window.scrollTo(0, 0);
    doc.style.scrollBehavior = prevBehavior;
  }, maxMs);
}

/** Scope auth headers (e.g. CF-Access tokens) to same-origin requests only.
 * Sending them cross-origin triggers CORS preflights on font CDNs that don't
 * expect custom headers, silently blocking web font downloads. */
export async function scopeRequestHeaders(page: Page, url: string, headers?: Record<string, string>): Promise<void> {
  if (!headers || Object.keys(headers).length === 0) return;
  const pageOrigin = new URL(url).origin;
  await page.route("**/*", (route, request) => {
    if (new URL(request.url()).origin === pageOrigin) {
      route.continue({ headers: { ...request.headers(), ...headers } });
    } else {
      route.continue();
    }
  });
}

/** Wait until every `<img>` has loaded (or failed) and decoded, bounded by
 * `maxMs`. Needed after autoScroll: an image it triggered starts loading after
 * the page already reached networkidle, and Playwright's load states are
 * sticky, so waiting for networkidle again returns at once. The bound is
 * inside the page, so the evaluate always settles rather than being left
 * pending on an image that never loads. */
export async function waitForImages(page: Page, maxMs: number): Promise<void> {
  if (maxMs <= 0) return;
  await page.evaluate((budget) => Promise.race([
    // An image that isn't rendered (display:none, or inside it) can't change
    // the pixels, and a lazy one there is never even requested: waiting on it
    // would spend the whole budget on every capture.
    Promise.all(Array.from(document.images).filter((img) => img.getClientRects().length > 0).map(async (img) => {
      if (!img.complete) {
        await new Promise((r) => {
          img.addEventListener("load", r, { once: true });
          img.addEventListener("error", r, { once: true });
        });
      }
      // A broken image rejects decode(); it's as rendered as it will get.
      await img.decode().catch(() => {});
    })),
    // Timers keep running under stabilize.clock (setFixedTime pins only Date).
    new Promise((r) => setTimeout(r, budget)),
  ]), maxMs);
}

export interface CaptureExtras {
  /** A target's recipe (RFC-0004). Validated here, so a malformed stored
   * recipe becomes an error row instead of a throw. */
  recipe?: Recipe;
  /** The side's session from setup, loaded into the context. */
  storageState?: StorageState;
}

/** Capture a PNG for one url at one viewport width: the full page, or with an
 * optional recipe, its steps run first and `capture.element` screenshotted. Never throws;
 * returns { ok:false, error } on failure so one bad page can't abort a run. */
export async function capture(
  browser: Browser,
  url: string,
  viewportWidth: number,
  opts: StabilizeOptions,
  insecure = false,
  requestHeaders?: Record<string, string>,
  extras: CaptureExtras = {},
): Promise<CaptureResult> {
  let recipe: CaptureRecipe | undefined;
  if (extras.recipe !== undefined) {
    const parsed = RecipeSchema.safeParse(extras.recipe);
    if (!parsed.success) return { ok: false, error: `invalid recipe: ${parsed.error.issues[0]?.message ?? "unknown"}` };
    recipe = parsed.data;
  }
  // Single shared deadline so nav + settle together honor one `timeoutMs` cap
  // (spec §6), rather than allowing up to 2× the configured budget.
  const deadline = Date.now() + opts.timeoutMs;
  // Declared before the try so context/page acquisition happens INSIDE it: if
  // the browser crashed/closed, newContext/newPage reject and we return
  // { ok:false } rather than throwing (upholds "one bad page can't abort a run").
  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, viewportWidth, insecure, extras.storageState,
      { reducedMotion: opts.reducedMotion, colorScheme: opts.colorScheme });
    const page = await context.newPage();
    await scopeRequestHeaders(page, url, requestHeaders);
    // Before navigation, so the page's first script already sees the pinned
    // date. setFixedTime leaves timers running: settle waits still elapse.
    if (opts.clock !== undefined) await page.clock.setFixedTime(new Date(opts.clock));
    // Hard navigation: a genuine load failure (DNS, connection refused, nav
    // timeout) throws here and is recorded as an error (spec §7).
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
    // An HTTP error (404/500/…) does NOT throw in Playwright — it returns a
    // response. Treat a non-2xx as a load failure per spec §7. Note: page.goto
    // can also return null (same-document / about:blank / some cached navs);
    // null is treated as success (no HTTP status to reject on).
    if (response && !response.ok()) {
      return { ok: false, error: `HTTP ${response.status()} at ${url}` };
    }
    // Soft settle: if the page loaded but `load`/`networkidle` never settles
    // (long-polling, beacons), capture anyway rather than erroring (spec §7).
    // Use the REMAINING budget; skip if already exhausted (never pass 0 —
    // Playwright treats timeout:0 as "no timeout" / wait forever).
    const remaining = deadline - Date.now();
    if (opts.waitUntil !== "domcontentloaded" && remaining > 0) {
      try {
        await page.waitForLoadState(opts.waitUntil, { timeout: remaining });
      } catch {
        // network never went idle within budget — proceed to capture
      }
    }
    // Trigger below-the-fold lazy loading (IntersectionObserver + native
    // loading="lazy") by scrolling through the page, then let the newly
    // requested resources settle. Bounded by the remaining budget so an
    // infinite-scroll page can't hang the capture.
    let budget = deadline - Date.now();
    if (budget > 0) {
      await autoScroll(page, budget);
      budget = deadline - Date.now();
      if (budget > 0) {
        try {
          await page.waitForLoadState("networkidle", { timeout: budget });
        } catch {
          // scroll-triggered loads didn't fully idle within budget — capture anyway
        }
      }
    }
    const fontBudget = Math.min(5000, Math.max(0, deadline - Date.now()));
    if (fontBudget > 0) {
      await Promise.race([
        page.evaluate(() => document.fonts.ready),
        page.waitForTimeout(fontBudget),
      ]);
    }
    if (opts.waitForImages) await waitForImages(page, deadline - Date.now());

    // Animations off before steps, so a transition a step triggers ends at
    // once; mask and remove after them, so steps can reach anything and
    // whatever they reveal is still masked (ADR-0029).
    if (opts.disableAnimations) await page.addStyleTag({ content: disableAnimationsCss() });
    if (recipe) await runSteps(page, recipe.steps, { timeoutMs: opts.timeoutMs });
    const mask = maskCss(opts.mask);
    if (mask) await page.addStyleTag({ content: mask });
    await removeSelectors(page, opts.remove);
    if (opts.settleMs > 0) await page.waitForTimeout(opts.settleMs);
    if (recipe?.capture) {
      const el = page.locator(recipe.capture.element).first();
      if ((await el.count()) === 0) {
        return { ok: false, error: `capture.element ${JSON.stringify(recipe.capture.element)} matched nothing` };
      }
      return { ok: true, png: new Uint8Array(await el.screenshot({ type: "png", timeout: opts.timeoutMs })) };
    }
    const png = await page.screenshot({ fullPage: true, type: "png" });
    return { ok: true, png: new Uint8Array(png) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context?.close();
  }
}
