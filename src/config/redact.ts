// src/config/redact.ts
import type { ResolvedConfig, SideSetup } from "./schema";
import { canonicalJson } from "../targets/target";

const REDACTED = "[redacted]";

/** A setup with its secrets replaced: fill values and the storageState file.
 * Selectors, step order and every other value stay, so a changed login flow is
 * still a changed setup (RFC-0004). */
export function redactSetup(s: SideSetup): SideSetup {
  if (s.storageState !== undefined) return { storageState: REDACTED };
  return { steps: s.steps!.map((st) => ("fill" in st ? { fill: [st.fill[0], REDACTED] as [string, string] } : st)) };
}

/** What the baseline gate compares: prod's setup only, since only prod shaped
 * the baseline's pixels. null when there is no setup, which is also what a
 * baseline from before setup existed reads as. */
export function setupIdentity(config: Pick<ResolvedConfig, "setup">): string | null {
  return config.setup ? canonicalJson(redactSetup(config.setup.prod)) : null;
}

/** The config as stored on runs and the snapshot, and as hashed. The .sqlite
 * is often committed, so it never holds a credential or a hash of one. */
export function redactConfig(config: ResolvedConfig): ResolvedConfig {
  if (!config.setup) return config;
  return { ...config, setup: { dev: redactSetup(config.setup.dev), prod: redactSetup(config.setup.prod) } };
}
