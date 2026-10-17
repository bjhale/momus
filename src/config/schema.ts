// src/config/schema.ts
import { z } from "zod";

// Steps are data, never callbacks (RFC-0004): they're stored with the
// baseline, compared by the per-target gate, and named in error rows. Each is
// a strict one-key object, so a typo is a config error rather than a no-op.
const selector = z.string().min(1);
export const StepSchema = z.union([
  z.object({ click: selector }).strict(),
  z.object({ hover: selector }).strict(),
  z.object({ fill: z.tuple([selector, z.string()]) }).strict(),
  // A bare key presses on the page; [selector, key] presses on that element.
  z.object({ press: z.union([z.string().min(1), z.tuple([selector, z.string().min(1)])]) }).strict(),
  z.object({ select: z.tuple([selector, z.string()]) }).strict(),
  z.object({ scroll: selector }).strict(),
  z.object({ waitFor: z.union([selector, z.object({ hidden: selector }).strict()]) }).strict(),
  z.object({ wait: z.number().int().positive() }).strict(),
  z.object({ evaluate: z.string().min(1) }).strict(),
]);
export type Step = z.infer<typeof StepSchema>;

// `goto` is setup-only: a scenario is one page (its `path`) in one state.
export const SetupStepSchema = z.union([StepSchema, z.object({ goto: z.string().min(1) }).strict()]);
export type SetupStep = z.infer<typeof SetupStepSchema>;

/** A scenario target's recipe as stored on its baseline row. capture()
 * re-validates with this, so a malformed stored recipe is an error row. */
export const RecipeSchema = z.object({
  steps: z.array(StepSchema),
  capture: z.object({ element: selector }).strict().optional(),
}).strict();
export type CaptureRecipe = z.infer<typeof RecipeSchema>;

const ScenarioSchema = z.object({
  id: z.string().regex(/^\S+$/, "scenario id must be non-empty with no whitespace"),
  path: z.string().startsWith("/"),
  steps: z.array(StepSchema).default([]),
  capture: z.object({ element: selector }).strict().optional(),
  viewports: z.array(z.number().int().positive()).min(1).optional(),
}).strict();

const exactlyOne = (s: { steps?: unknown; storageState?: unknown }) =>
  (s.steps === undefined) !== (s.storageState === undefined);

const SideSetupSchema = z.object({
  steps: z.array(SetupStepSchema).min(1).optional(),
  storageState: z.string().min(1).optional(),
}).strict().refine(exactlyOne, { message: "give exactly one of steps or storageState" });
export type SideSetup = z.infer<typeof SideSetupSchema>;

// One setup shared by both sides, or one per side; never a mix, so there's no
// question of which wins. A per-side setup names both sides: a forgotten side
// would silently capture the login screen (RFC-0004).
const SetupSchema = z.object({
  steps: z.array(SetupStepSchema).min(1).optional(),
  storageState: z.string().min(1).optional(),
  dev: SideSetupSchema.optional(),
  prod: SideSetupSchema.optional(),
}).strict().superRefine((s, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const shared = s.steps !== undefined || s.storageState !== undefined;
  const perSide = s.dev !== undefined || s.prod !== undefined;
  if (shared && perSide) issue("setup: use a shared setup (steps or storageState) or per-side dev and prod, not both");
  else if (perSide && (s.dev === undefined || s.prod === undefined)) issue("setup: a per-side setup must define both dev and prod");
  else if (!perSide && !exactlyOne(s)) issue("setup: give exactly one of steps or storageState");
}).transform((s): { dev: SideSetup; prod: SideSetup } => {
  if (s.dev && s.prod) return { dev: s.dev, prod: s.prod };
  const side: SideSetup = s.steps ? { steps: s.steps } : { storageState: s.storageState! };
  return { dev: side, prod: side };
});

export const ConfigSchema = z.object({
  dev: z.string().url(),
  prod: z.string().url(),
  insecure: z.boolean().default(false),
  requestHeaders: z.record(z.string(), z.string()).default({}),
  browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
  discovery: z.object({
    urlList: z.string().optional(),
    sitemap: z.boolean().default(true),
    maxPages: z.number().int().nonnegative().default(500), // 0 = unlimited
    crawl: z.union([
      z.boolean(),
      z.object({
        enabled: z.boolean().default(true), // an object means you opted in
        startPath: z.string().default("/"),
        maxDepth: z.number().int().positive().default(3),
      }),
    ]).default(false).transform((v) =>
      typeof v === "boolean"
        ? { enabled: v, startPath: "/", maxDepth: 3 }
        : v),
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
    remove: z.array(z.string()).default([]),
  }).default({}),
  diff: z.object({
    threshold: z.number().min(0).max(1).default(0.1),
    failScore: z.number().min(0).max(1).default(0.01),
    overrides: z.array(z.object({
      path: z.string(),
      failScore: z.number().min(0).max(1),
    })).default([]),
    // Added/removed targets fail the gate unless allowed (RFC-0001, ADR-0022).
    allowAdded: z.boolean().default(false),
    allowRemoved: z.boolean().default(false),
  }).default({}),
  concurrency: z.object({
    screenshots: z.number().int().positive().default(6),
    diffWorkers: z.number().int().positive().default(4),
  }).default({}),
  output: z.object({
    report: z.string().default("momus-report.html"),
    db: z.string().default("momus.sqlite"),
    // Runs kept in output.db; 0 = unlimited. Small by default because the file
    // is often committed (RFC-0002, ADR-0025).
    keepRuns: z.number().int().nonnegative().default(5),
  }).default({}),
  scenarios: z.array(ScenarioSchema).default([]).superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: `duplicate scenario id "${s.id}"` });
      seen.add(s.id);
    });
  }),
  setup: SetupSchema.optional(),
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
