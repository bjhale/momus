// src/targets/target.ts
import type { ResolvedConfig } from "../config/schema";

/** Where a target came from. Provenance only: capture, diff and gating never
 * branch on it (RFC-0001, ADR-0021). Only `pages` ships today; `scenarios` and
 * `storybook` are reserved for RFC-0004 and RFC-0005. */
export type TargetSourceName = "pages" | "scenarios" | "storybook";

/** How to capture a target beyond "load the URL". Opaque until RFC-0004 defines
 * steps and element capture. It exists now so a recipe is stored with each
 * baseline row and gated per target (ADR-0023). */
export type Recipe = Record<string, unknown>;

/** The pipeline's unit of work, captured once per viewport. */
export interface Target {
  /** Stable and unique across sources; the DB key with the viewport. */
  id: string;
  source: TargetSourceName;
  /** What the report shows. */
  label: string;
  /** What include/exclude and diff.overrides match against. */
  path: string;
  url: { dev: string; prod: string };
  recipe?: Recipe;
  /** Narrows the configured viewports; can never add widths (expandViewports). */
  viewports?: number[];
}

/** The slice of a baseline row a source needs to build its live list. */
export interface BaselineTargetRef { targetId: string; path: string }

export interface TargetSource {
  name: TargetSourceName;
  /** Every target, for capturing a baseline. May hit the network. */
  listForSnapshot(): Promise<Target[]>;
  /** The live list for a run against a frozen baseline. `baseline` holds this
   * source's baseline rows. A baseline target missing from the result is
   * reported `removed`. */
  listLive(baseline: BaselineTargetRef[]): Promise<Target[]>;
}

/** A discovered page. Its id is the bare path, so a pages-only config produces
 * the same keys a pre-targets DB stored. */
export function pageTarget(path: string, config: Pick<ResolvedConfig, "dev" | "prod">): Target {
  return {
    id: path, source: "pages", label: path, path,
    url: { dev: new URL(path, config.dev).toString(), prod: new URL(path, config.prod).toString() },
  };
}

/** Filtering the configured list (rather than taking the target's) keeps the
 * configured order and guarantees no width the baseline lacks. The global gate
 * already makes configured viewports equal the baseline's. */
export function expandViewports(target: Target, configured: number[]): number[] {
  if (!target.viewports) return configured;
  return configured.filter((v) => target.viewports!.includes(v));
}

/** Stable JSON for comparing recipes: object keys are sorted at every depth,
 * so key order in a config file never reads as a changed recipe. */
export function canonicalJson(recipe: Recipe | undefined): string | null {
  return recipe === undefined ? null : JSON.stringify(sortKeys(recipe));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

/** Page ids are paths ("/…"); every other source prefixes its name
 * ("scenarios:…"). The prefix is what makes ids unique across sources. */
export function checkTargetIds(targets: Target[]): void {
  const seen = new Set<string>();
  for (const t of targets) {
    const prefix = t.source === "pages" ? "/" : `${t.source}:`;
    if (!t.id.startsWith(prefix)) {
      throw new Error(`target id "${t.id}" from source ${t.source} must start with "${prefix}"`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate target id "${t.id}"`);
    seen.add(t.id);
  }
}
