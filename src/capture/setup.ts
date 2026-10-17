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
    try {
      return JSON.parse(await readFile(setup.storageState)) as StorageState;
    } catch (err) {
      throw new SetupError(side, `storageState ${JSON.stringify(setup.storageState)}: ${reason(err)}`);
    }
  }

  let context: BrowserContext | undefined;
  try {
    context = await newContext(browser, config.viewports[0]!, config.insecure);
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
