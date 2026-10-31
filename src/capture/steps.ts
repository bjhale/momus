// src/capture/steps.ts
import type { Page } from "playwright-core";
import type { SetupStep } from "../config/schema";

/** A step failed. `index` is 1-based, as people count steps in a config file.
 * The message never carries a typed value: setup `fill` values are secrets. */
export class StepError extends Error {
  constructor(readonly index: number, readonly step: string, cause: string) {
    super(`step ${index}: ${step}: ${cause}`);
    this.name = "StepError";
  }
}

const q = JSON.stringify;

/** The verb and its selector, for error messages. */
export function describeStep(step: SetupStep): string {
  if ("click" in step) return `click ${q(step.click)}`;
  if ("hover" in step) return `hover ${q(step.hover)}`;
  if ("fill" in step) return `fill ${q(step.fill[0])}`;
  if ("press" in step) {
    return typeof step.press === "string" ? `press ${q(step.press)}` : `press ${q(step.press[1])} on ${q(step.press[0])}`;
  }
  if ("select" in step) return `select ${q(step.select[0])}`;
  if ("scroll" in step) return `scroll ${q(step.scroll)}`;
  if ("waitFor" in step) {
    return typeof step.waitFor === "string" ? `waitFor ${q(step.waitFor)}` : `waitFor hidden ${q(step.waitFor.hidden)}`;
  }
  if ("wait" in step) return `wait ${step.wait}ms`;
  if ("evaluate" in step) return "evaluate";
  return `goto ${q(step.goto)}`;
}

export interface StepOptions {
  /** Per step, not a shared deadline: a long scenario isn't starved by its
   * own early steps. */
  timeoutMs: number;
  /** What `goto` resolves against: each side's own base URL, so one set of
   * setup steps works on both sides. */
  baseUrl?: string;
}

/** Run steps in order; the first failure throws a StepError. */
export async function runSteps(page: Page, steps: readonly SetupStep[], opts: StepOptions): Promise<void> {
  for (const [i, step] of steps.entries()) {
    try {
      await runStep(page, step, opts);
    } catch (err) {
      throw new StepError(i + 1, describeStep(step), firstLine(err));
    }
  }
}

async function runStep(page: Page, step: SetupStep, { timeoutMs: timeout, baseUrl }: StepOptions): Promise<void> {
  // first(): a selector matching several elements acts on the first, the same
  // rule element capture uses, instead of failing Playwright's strict mode.
  const at = (sel: string) => page.locator(sel).first();
  if ("click" in step) return at(step.click).click({ timeout });
  if ("hover" in step) return at(step.hover).hover({ timeout });
  if ("fill" in step) return at(step.fill[0]).fill(step.fill[1], { timeout });
  if ("press" in step) {
    return typeof step.press === "string"
      ? page.keyboard.press(step.press)
      : at(step.press[0]).press(step.press[1], { timeout });
  }
  if ("select" in step) { await at(step.select[0]).selectOption(step.select[1], { timeout }); return; }
  if ("scroll" in step) return at(step.scroll).scrollIntoViewIfNeeded({ timeout });
  if ("waitFor" in step) {
    return typeof step.waitFor === "string"
      ? at(step.waitFor).waitFor({ state: "visible", timeout })
      : at(step.waitFor.hidden).waitFor({ state: "hidden", timeout });
  }
  if ("wait" in step) return page.waitForTimeout(step.wait);
  if ("evaluate" in step) { await page.evaluate(step.evaluate); return; }
  if (!baseUrl) throw new Error("goto needs a base URL");
  const url = new URL(step.goto, baseUrl).toString();
  const res = await page.goto(url, { waitUntil: "load", timeout });
  // As in capture(): Playwright resolves an HTTP error page instead of throwing.
  if (res && !res.ok()) throw new Error(`HTTP ${res.status()} at ${url}`);
}

/** Playwright errors append a multi-line call log; the first line is the reason. */
function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!.trim();
}
