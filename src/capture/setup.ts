// src/capture/setup.ts
import type { Browser, BrowserContext } from "playwright-core";
import type { ResolvedConfig } from "../config/schema";
import { newContext, type StorageState } from "./browser";
import { scopeRequestHeaders } from "./screenshot";
import { runSteps } from "./steps";

export type Side = "dev" | "prod";

/** Setup couldn't produce a session. Operational (exit 2), never per-target:
 * without a session every capture is the login screen, and 500 identical
 * passing login forms would be a lie (RFC-0004). */
export class SetupError extends Error {
  constructor(side: Side, detail: string) {
    super(`setup (${side}) ${detail}`);
    this.name = "SetupError";
  }
}

/** The viewport the login runs at: the widest configured. Many sites hide the
 * login form or its submit button behind a hamburger menu at mobile widths, so
 * the first viewport (375 by default) would make setup steps fail to find it. */
export function setupViewport(config: ResolvedConfig): number {
  return Math.max(...config.viewports);
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Log in once for one side and return the session every capture context for
 * that side loads, or undefined when there is no setup. The session stays in
 * memory: it is never written to the .sqlite or the report. */
export async function runSetup(
  browser: Browser, side: Side, config: ResolvedConfig,
  readFile: (path: string) => Promise<string> = (p) => Bun.file(p).text(),
): Promise<StorageState | undefined> {
  const setup = config.setup?.[side];
  if (!setup) return undefined;

  if (setup.storageState !== undefined) {
    const path = JSON.stringify(setup.storageState);
    let text: string;
    try {
      text = await readFile(setup.storageState);
    } catch (err) {
      throw new SetupError(side, `storageState ${path}: ${reason(err)}`);
    }
    let state: unknown;
    try {
      state = JSON.parse(text);
    } catch {
      // Fixed reason: a SyntaxError can quote a token from the file, and the file holds session secrets.
      throw new SetupError(side, `storageState ${path}: not valid JSON`);
    }
    const s = state as { cookies?: unknown; origins?: unknown } | null;
    // Checked here so a bad file fails setup once (exit 2) instead of erroring every capture.
    if (typeof s !== "object" || s === null || !Array.isArray(s.cookies) || !Array.isArray(s.origins)) {
      throw new SetupError(side, `storageState ${path}: expected { cookies: [], origins: [] }`);
    }
    return s as StorageState;
  }

  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, setupViewport(config), config.insecure);
    const page = await context.newPage();
    await scopeRequestHeaders(page, config[side], config.requestHeaders);
    await runSteps(page, setup.steps!, { timeoutMs: config.stabilize.timeoutMs, baseUrl: config[side] });
    return await context.storageState();
  } catch (err) {
    throw new SetupError(side, reason(err));
  } finally {
    await context?.close().catch(() => {});
  }
}
