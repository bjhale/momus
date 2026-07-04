// src/config/schema.ts
import { z } from "zod";

export const ConfigSchema = z.object({
  dev: z.string().url(),
  prod: z.string().url(),
  discovery: z.object({
    sitemap: z.boolean().default(true),
    crawl: z.object({
      enabled: z.boolean().default(true),
      startPath: z.string().default("/"),
      maxDepth: z.number().int().positive().default(3),
      maxPages: z.number().int().positive().default(500),
    }).default({}),
    include: z.array(z.string()).default(["/**"]),
    exclude: z.array(z.string()).default([]),
  }).default({}),
  viewports: z.array(z.number().int().positive()).default([375, 768, 1280]),
  stabilize: z.object({
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
    settleMs: z.number().int().nonnegative().default(500),
    timeoutMs: z.number().int().positive().default(15000),
    disableAnimations: z.boolean().default(true),
    mask: z.array(z.string()).default([]),
  }).default({}),
  diff: z.object({
    threshold: z.number().min(0).max(1).default(0.1),
    failScore: z.number().min(0).max(1).default(0.01),
    overrides: z.array(z.object({
      path: z.string(),
      failScore: z.number().min(0).max(1),
    })).default([]),
  }).default({}),
  concurrency: z.object({
    screenshots: z.number().int().positive().default(6),
    diffWorkers: z.number().int().positive().default(4),
  }).default({}),
  output: z.object({
    report: z.string().default("momus-report.html"),
    db: z.string().default("momus.sqlite"),
  }).default({}),
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type ResolvedConfig = z.output<typeof ConfigSchema>;

/** Typed helper for momus.config.ts authors. Identity at runtime. */
export function defineConfig(config: RawConfig): RawConfig {
  return config;
}

/** Zod already fills defaults on parse; this is an explicit re-parse for callers
 * holding an already-parsed object plus a stable name for tests. */
export function applyDefaults(config: ResolvedConfig): ResolvedConfig {
  return ConfigSchema.parse(config);
}
