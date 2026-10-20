// src/index.ts
// The whole 1.x programmatic API (RFC-0009, ADR-0041): typed config authoring.
// Everything else under src/ is internal and may change in any release.
export { defineConfig } from "./config/schema";
export type { RawConfig, ResolvedConfig } from "./config/schema";
