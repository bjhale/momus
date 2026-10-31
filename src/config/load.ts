// src/config/load.ts
import type { ZodIssue } from "zod";
import { ConfigSchema, type RawConfig, type ResolvedConfig } from "./schema";
import { knownKeys, suggest } from "./suggest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export interface CliOverrides {
  dev?: string;
  prod?: string;
  out?: string;
  concurrency?: number;
  crawl?: boolean;
  maxPages?: number;
  insecure?: boolean;
  browser?: string;
  allowAdded?: boolean;
  allowRemoved?: boolean;
  reportImages?: string;
}

/** Merge file config + CLI overrides, then validate. CLI wins (spec §6). */
export function resolveConfig(fileConfig: RawConfig, cli: CliOverrides): ResolvedConfig {
  const merged: RawConfig = structuredClone(fileConfig);
  if (cli.dev !== undefined) merged.dev = cli.dev;
  if (cli.prod !== undefined) merged.prod = cli.prod;
  if (cli.out !== undefined) {
    merged.output = { ...(merged.output ?? {}), report: cli.out };
  }
  if (cli.reportImages !== undefined) {
    merged.output = { ...(merged.output ?? {}), reportImages: cli.reportImages as NonNullable<RawConfig["output"]>["reportImages"] };
  }
  if (cli.concurrency !== undefined) {
    merged.concurrency = { ...(merged.concurrency ?? {}), screenshots: cli.concurrency };
  }
  if (cli.maxPages !== undefined) {
    merged.discovery = { ...(merged.discovery ?? {}), maxPages: cli.maxPages };
  }
  if (cli.crawl !== undefined) {
    const existing = merged.discovery?.crawl;
    const crawlObj = existing && typeof existing === "object" ? existing : {};
    merged.discovery = {
      ...(merged.discovery ?? {}),
      crawl: { ...crawlObj, enabled: cli.crawl },
    };
  }
  if (cli.browser !== undefined) merged.browser = cli.browser as RawConfig["browser"];
  if (cli.insecure !== undefined) merged.insecure = cli.insecure;
  if (cli.allowAdded !== undefined) {
    merged.diff = { ...(merged.diff ?? {}), allowAdded: cli.allowAdded };
  }
  if (cli.allowRemoved !== undefined) {
    merged.diff = { ...(merged.diff ?? {}), allowRemoved: cli.allowRemoved };
  }
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) throw new Error(formatIssues(parsed.error.issues).join("\n"));
  return parsed.data;
}

/** One `path: message` line per issue: commands print this after "Config
 * error:", and ZodError's own message is a JSON dump of every issue. */
// Keys that moved, so the error says where rather than guessing a sibling.
const MOVED: Record<string, string> = { "discovery.crawl.maxPages": "discovery.maxPages" };

function formatIssues(issues: ZodIssue[]): string[] {
  return issues.flatMap((i): string[] => {
    // Config paths are never symbols; Zod's type allows them.
    const path = i.path as (string | number)[];
    // `crawl: true | {...}`: a wrong value inside the object fails the whole
    // union. Report the branches that got past "wrong type" (the object's own
    // issues), not "invalid input". Their paths are relative to the union.
    if (i.code === "invalid_union") {
      const inner = i.errors.flat().filter((u) => u.code !== "invalid_type" || u.path.length > 0)
        .map((u) => ({ ...u, path: [...path, ...u.path] }) as ZodIssue);
      if (inner.length) return formatIssues(inner);
    }
    if (i.code === "unrecognized_keys") {
      const known = knownKeys(ConfigSchema, path);
      return i.keys.map((k) => {
        const at = [...path, k].join(".");
        if (MOVED[at]) return `${at}: unknown key; it moved to ${MOVED[at]}`;
        const hint = suggest(k, known);
        return `${at}: unknown key${hint ? `; did you mean "${hint}"?` : ""}`;
      });
    }
    return [`${path.join(".") || "(config)"}: ${i.message}`];
  });
}

/** Locate and import a config file, returning the raw (unvalidated) object.
 * Supports .ts/.js (default export) and .json. Paths are resolved against the
 * process cwd so a CLI-supplied relative path loads the user's file, not one
 * relative to this module. */
export async function loadConfigFile(path: string): Promise<RawConfig> {
  const abs = resolve(process.cwd(), path);
  if (abs.endsWith(".json")) {
    return (await Bun.file(abs).json()) as RawConfig;
  }
  const mod = await import(pathToFileURL(abs).href);
  return (mod.default ?? mod) as RawConfig;
}
