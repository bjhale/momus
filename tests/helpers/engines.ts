// tests/helpers/engines.ts
import { isBrowserInstalled, launchBrowser, type BrowserEngine } from "../../src/capture/browser";

// An installed binary can still fail to launch when the host lacks the engine's
// system libraries (e.g. WebKit on WSL); that's an environment gap, not a regression.
const probes = new Map<BrowserEngine, Promise<boolean>>();

export function launchable(engine: BrowserEngine): Promise<boolean> {
  let p = probes.get(engine);
  if (!p) {
    p = (async () => {
      if (!isBrowserInstalled(engine)) return false;
      try {
        await (await launchBrowser(engine)).close();
        return true;
      } catch {
        return false;
      }
    })();
    probes.set(engine, p);
  }
  return p;
}

const KNOWN: BrowserEngine[] = ["chromium", "firefox", "webkit"];

function pickEngines(): BrowserEngine[] {
  const e = process.env.MOMUS_ENGINE;
  if (!e) return ["chromium"];
  if (!KNOWN.includes(e as BrowserEngine)) throw new Error(`MOMUS_ENGINE must be one of ${KNOWN.join(", ")}, got "${e}"`);
  return [e as BrowserEngine];
}

// Launching a second engine in the same bun test process makes later Playwright
// launches fail intermittently (Bun spawn "Failed to connect"), so each
// non-default engine runs in its own process via `bun run test:engines`.
export const TEST_ENGINES: BrowserEngine[] = pickEngines();

/** A browser file that tips Bun's child-process hang (a close that never
 * settles, in whichever file launches next) when it shares a process with the
 * rest of the suite. It runs only when MOMUS_ISOLATED names it, which
 * `bun run test:isolated` does, one process per file (ADR-0036). */
export function isolated(name: string): boolean {
  return process.env.MOMUS_ISOLATED === name;
}
