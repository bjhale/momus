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
  if (cli.crawl !== undefined) {
    merged.discovery = {
      ...(merged.discovery ?? {}),
      crawl: { ...(merged.discovery?.crawl ?? {}), enabled: cli.crawl },
    };
  }
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
