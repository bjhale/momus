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

/** Every engine by default, in this one process (ADR-0036); each is skipped
 * where it can't launch. MOMUS_ENGINE narrows to one, for a quicker loop. */
function pickEngines(): BrowserEngine[] {
  const e = process.env.MOMUS_ENGINE;
  if (!e) return KNOWN;
  if (!KNOWN.includes(e as BrowserEngine)) throw new Error(`MOMUS_ENGINE must be one of ${KNOWN.join(", ")}, got "${e}"`);
  return [e as BrowserEngine];
}

export const TEST_ENGINES: BrowserEngine[] = pickEngines();
