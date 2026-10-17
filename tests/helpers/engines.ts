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
