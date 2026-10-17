// tests/setup.ts
import { setDefaultTimeout } from "bun:test";

// Browser-guarded tests launch a real Chromium, and a cold launch on a shared
// CI runner can alone exceed bun's 5s default — whichever test launches first
// times out. 30s keeps a genuine hang visible without flaking on slow starts.
setDefaultTimeout(30_000);
