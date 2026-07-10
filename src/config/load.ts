// src/config/load.ts
import { ConfigSchema, type RawConfig, type ResolvedConfig } from "./schema";
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
}

/** Merge file config + CLI overrides, then validate. CLI wins (spec §6). */
export function resolveConfig(fileConfig: RawConfig, cli: CliOverrides): ResolvedConfig {
  const merged: RawConfig = structuredClone(fileConfig);
  if (cli.dev !== undefined) merged.dev = cli.dev;
  if (cli.prod !== undefined) merged.prod = cli.prod;
  if (cli.out !== undefined) {
    merged.output = { ...(merged.output ?? {}), report: cli.out };
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
  return ConfigSchema.parse(merged);
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
