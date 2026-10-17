// src/config/schema.ts
import { z } from "zod";

// Steps are data, never callbacks (RFC-0004): they're stored with the
// baseline, compared by the per-target gate, and named in error rows. Each is
// a one-key object, so a typo is a config error rather than a no-op.
const selector = z.string().min(1);
const stepVerbs = {
  click: selector,
  hover: selector,
  // An unset Bun.env value arrives as undefined; say so rather than "Required".
  fill: z.tuple([selector, z.string({ required_error: "fill value is undefined — is the environment variable set?" })]),
  // A bare key presses on the page; [selector, key] presses on that element.
  press: z.union([z.string().min(1), z.tuple([selector, z.string().min(1)])]),
  select: z.tuple([selector, z.string()]),
  scroll: selector,
  waitFor: z.union([selector, z.object({ hidden: selector }).strict()]),
  wait: z.number().int().positive(),
  evaluate: z.string().min(1),
};

type OneKey<V extends Record<string, z.ZodTypeAny>, T extends "input" | "output"> = {
  [K in keyof V]: { [P in K]: T extends "input" ? z.input<V[K]> : z.output<V[K]> }
}[keyof V];

/** A step schema that dispatches on the step's single key. A z.union of
 * one-key objects reports every alternative's failure when one step is wrong
 * (hundreds of lines for one unset env var); dispatching reports only the
 * named verb's issues, at that verb's path. */
function oneKeyStep<V extends Record<string, z.ZodTypeAny>>(verbs: V) {
  const names = Object.keys(verbs);
  return z.unknown().transform((step, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      return fail(`a step is an object with one key, e.g. { click: "#menu" }`);
    }
    const keys = Object.keys(step);
    if (keys.length !== 1) return fail(`a step has exactly one key, got ${keys.join(", ") || "none"}`);
    const verb = keys[0]!;
    if (!Object.hasOwn(verbs, verb)) return fail(`unknown step "${verb}"; expected one of ${names.join(", ")}`);
    const parsed = verbs[verb]!.safeParse((step as Record<string, unknown>)[verb]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [verb, ...issue.path], message: issue.message });
      }
      return z.NEVER;
    }
    return { [verb]: parsed.data } as OneKey<V, "output">;
  }) as unknown as z.ZodType<OneKey<V, "output">, z.ZodTypeDef, OneKey<V, "input">>;
}

export const StepSchema = oneKeyStep(stepVerbs);
export type Step = z.infer<typeof StepSchema>;

// `goto` is setup-only: a scenario is one page (its `path`) in one state.
export const SetupStepSchema = oneKeyStep({ ...stepVerbs, goto: z.string().min(1) });
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
}).superRefine((c, ctx) => {
  // Jobs are scenario viewports ∩ top-level viewports; a scenario sharing no
  // width with the top level would silently produce zero jobs.
  c.scenarios.forEach((s, i) => {
    const stray = (s.viewports ?? []).filter((w) => !c.viewports.includes(w)).sort((a, b) => a - b);
    if (stray.length > 0) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["scenarios", i, "viewports"],
      message: `scenario "${s.id}" viewports ${stray.join(", ")} are not in the top-level viewports (${c.viewports.join(", ")})`,
    });
  });
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
