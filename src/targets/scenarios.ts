// src/targets/scenarios.ts
import type { ResolvedConfig } from "../config/schema";
import type { Target, TargetSource } from "./target";

/** Configured scenarios as targets (RFC-0004). The list is the config, so a
 * run builds it without prod or the network, and a scenario deleted from the
 * config is reported `removed` (ADR-0022). Discovery filters don't apply:
 * a scenario is listed on purpose. */
export function scenariosSource(config: Pick<ResolvedConfig, "dev" | "prod" | "scenarios">): TargetSource {
  const list = async (): Promise<Target[]> => config.scenarios.map((s) => ({
    id: `scenarios:${s.id}`, source: "scenarios", label: s.id, path: s.path,
    url: { dev: new URL(s.path, config.dev).toString(), prod: new URL(s.path, config.prod).toString() },
    recipe: s.capture ? { steps: s.steps, capture: s.capture } : { steps: s.steps },
    ...(s.viewports ? { viewports: s.viewports } : {}),
  }));
  return { name: "scenarios", listForSnapshot: list, listLive: list };
}
