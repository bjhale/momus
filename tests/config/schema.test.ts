// tests/config/schema.test.ts
import { test, expect } from "bun:test";
import { ConfigSchema, defineConfig, applyDefaults } from "../../src/config/schema";

test("minimal config validates and gets defaults", () => {
  const parsed = ConfigSchema.parse({
    dev: "https://dev.example.com",
    prod: "https://www.example.com",
  });
  const c = applyDefaults(parsed);
  expect(c.viewports).toEqual([375, 768, 1280]);
  expect(c.diff.failScore).toBe(0.01);
  expect(c.concurrency.screenshots).toBe(6);
  expect(c.stabilize.timeoutMs).toBe(15000);
});

test("invalid url is rejected", () => {
  expect(() => ConfigSchema.parse({ dev: "not-a-url", prod: "https://x.com" }))
    .toThrow();
});

test("defineConfig is an identity passthrough", () => {
  const raw = { dev: "https://a.com", prod: "https://b.com" };
  expect(defineConfig(raw)).toBe(raw);
});

test("discovery.maxPages defaults to 500 and rejects negatives", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.discovery.maxPages).toBe(500);
  expect(() => ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { maxPages: -1 } })).toThrow();
});

test("discovery.maxPages accepts 0 (unlimited)", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { maxPages: 0 } });
  expect(c.discovery.maxPages).toBe(0);
});

test("crawl defaults to disabled when omitted", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.discovery.crawl).toEqual({ enabled: false, startPath: "/", maxDepth: 3 });
});

test("crawl accepts boolean shorthands", () => {
  const off = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: false } });
  expect(off.discovery.crawl.enabled).toBe(false);
  const on = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: true } });
  expect(on.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 3 });
});

test("crawl object opts in and applies overrides; enabled:false still disables", () => {
  const obj = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { maxDepth: 5 } } });
  expect(obj.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 5 });
  const disabled = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { enabled: false, maxDepth: 5 } } });
  expect(disabled.discovery.crawl.enabled).toBe(false);
});

test("legacy crawl.maxPages is ignored without error", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { crawl: { maxPages: 999 } as any } });
  expect(c.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 3 });
  expect((c.discovery.crawl as any).maxPages).toBeUndefined();
});

test("discovery.urlList is optional and passes through", () => {
  const withList = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", discovery: { urlList: "urls.txt" } });
  expect(withList.discovery.urlList).toBe("urls.txt");
  const without = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(without.discovery.urlList).toBeUndefined();
});

test("insecure defaults to false and accepts true", () => {
  const d = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(d.insecure).toBe(false);
  const t = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", insecure: true });
  expect(t.insecure).toBe(true);
});

test("requestHeaders defaults to an empty object", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.requestHeaders).toEqual({});
});

test("requestHeaders accepts a map of string headers", () => {
  const c = ConfigSchema.parse({
    dev: "https://d.com",
    prod: "https://p.com",
    requestHeaders: { "CF-Access-Client-Id": "abc", "CF-Access-Client-Secret": "xyz" },
  });
  expect(c.requestHeaders).toEqual({ "CF-Access-Client-Id": "abc", "CF-Access-Client-Secret": "xyz" });
});

test("requestHeaders rejects non-string values", () => {
  expect(() => ConfigSchema.parse({
    dev: "https://d.com",
    prod: "https://p.com",
    requestHeaders: { "X-Count": 5 as any },
  })).toThrow();
});

test("browser defaults to chromium", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.browser).toBe("chromium");
});

test("browser accepts firefox and webkit", () => {
  expect(ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "firefox" }).browser).toBe("firefox");
  expect(ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "webkit" }).browser).toBe("webkit");
});

test("browser rejects an unknown engine", () => {
  expect(() => ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", browser: "safari" })).toThrow();
});

test("stabilize.remove defaults to [] and accepts selectors", () => {
  const d = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(d.stabilize.remove).toEqual([]);
  const r = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com", stabilize: { remove: [".x", "#y"] } });
  expect(r.stabilize.remove).toEqual([".x", "#y"]);
});

test("diff.allowAdded / allowRemoved default to false", () => {
  const c = ConfigSchema.parse({ dev: "https://d.com", prod: "https://p.com" });
  expect(c.diff.allowAdded).toBe(false);
  expect(c.diff.allowRemoved).toBe(false);
});

test("output.keepRuns defaults to 5 and accepts 0 (unlimited)", () => {
  const base = { dev: "https://d.example.com", prod: "https://p.example.com" };
  expect(ConfigSchema.parse(base).output.keepRuns).toBe(5);
  expect(ConfigSchema.parse({ ...base, output: { keepRuns: 0 } }).output.keepRuns).toBe(0);
  expect(() => ConfigSchema.parse({ ...base, output: { keepRuns: -1 } })).toThrow();
});

// RFC-0004: scenarios and setup
const rfc4Base = { dev: "https://dev.example.com", prod: "https://www.example.com" };

test("scenarios default to [] and setup to undefined", () => {
  const c = ConfigSchema.parse(rfc4Base);
  expect(c.scenarios).toEqual([]);
  expect(c.setup).toBeUndefined();
});

test("a scenario parses with every step kind, and steps default to []", () => {
  const c = ConfigSchema.parse({ ...rfc4Base, scenarios: [
    { id: "all", path: "/", capture: { element: "nav" }, viewports: [375], steps: [
      { click: "button" }, { hover: "a" }, { fill: ["#q", "hi"] }, { press: "Escape" },
      { press: ["#q", "Enter"] }, { select: ["select", "b"] }, { scroll: "footer" },
      { waitFor: "nav" }, { waitFor: { hidden: ".spinner" } }, { wait: 50 }, { evaluate: "1" },
    ] },
    { id: "bare", path: "/about" },
  ] });
  expect(c.scenarios[0]!.steps.length).toBe(11);
  expect(c.scenarios[1]!.steps).toEqual([]);
});

test("scenarios reject unknown step kinds, goto, two-key steps, and bad ids/paths", () => {
  const bad = (s: unknown) => expect(() => ConfigSchema.parse({ ...rfc4Base, scenarios: [s] })).toThrow();
  bad({ id: "a", path: "/", steps: [{ tap: "x" }] });
  bad({ id: "a", path: "/", steps: [{ goto: "/x" }] });          // goto is setup-only
  bad({ id: "a", path: "/", steps: [{ click: "x", hover: "y" }] });
  bad({ id: "has space", path: "/" });
  bad({ id: "a", path: "no-slash" });
  bad({ id: "a", path: "/", extra: true });
});

test("duplicate scenario ids are a config error naming the id", () => {
  expect(() => ConfigSchema.parse({ ...rfc4Base, scenarios: [{ id: "x", path: "/" }, { id: "x", path: "/a" }] }))
    .toThrow(/duplicate scenario id \\?"x\\?"/); // ZodError.message is JSON, so the quotes arrive escaped
});

test("a shared setup is normalized onto both sides", () => {
  const steps = [{ goto: "/login" }, { click: "button" }];
  const c = ConfigSchema.parse({ ...rfc4Base, setup: { steps } });
  expect(c.setup).toEqual({ dev: { steps }, prod: { steps } });
  const s = ConfigSchema.parse({ ...rfc4Base, setup: { storageState: "auth.json" } });
  expect(s.setup).toEqual({ dev: { storageState: "auth.json" }, prod: { storageState: "auth.json" } });
});

test("a per-side setup keeps each side, and may mix steps and storageState", () => {
  const c = ConfigSchema.parse({ ...rfc4Base, setup: {
    dev: { steps: [{ goto: "/login" }] }, prod: { storageState: "prod.json" } } });
  expect(c.setup).toEqual({ dev: { steps: [{ goto: "/login" }] }, prod: { storageState: "prod.json" } });
});

test("setup rejects mixing shared and per-side, one side only, both or neither of steps/storageState", () => {
  const bad = (setup: unknown, msg: RegExp) => expect(() => ConfigSchema.parse({ ...rfc4Base, setup })).toThrow(msg);
  bad({ steps: [{ goto: "/" }], dev: { steps: [{ goto: "/" }] } }, /not both/);
  bad({ dev: { steps: [{ goto: "/" }] } }, /both dev and prod/);
  bad({ steps: [{ goto: "/" }], storageState: "a.json" }, /exactly one of steps or storageState/);
  bad({}, /exactly one of steps or storageState/);
  bad({ dev: { steps: [{ goto: "/" }], storageState: "a" }, prod: { storageState: "b" } }, /exactly one/);
  bad({ steps: [] }, /./); // an empty login is a mistake, not a no-op
});

test("parsing a resolved config again is idempotent (applyDefaults re-parses)", () => {
  const once = ConfigSchema.parse({ ...rfc4Base, setup: { steps: [{ goto: "/login" }] },
    scenarios: [{ id: "a", path: "/", steps: [{ click: "b" }] }] });
  expect(ConfigSchema.parse(once)).toEqual(once);
});

// A step is checked against its own verb's schema, so a failure names that
// verb's issue at its path instead of nine union alternatives.
const issuesOf = (input: unknown) => {
  const r = ConfigSchema.safeParse(input);
  if (r.success) throw new Error("expected a parse failure");
  return r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("an undefined fill value (unset env var) is one issue at its path with a hint", () => {
  const issues = issuesOf({ ...rfc4Base, setup: { steps: [
    { goto: "/login" }, { fill: ["#password", undefined] }, { click: "button[type=submit]" },
  ] } });
  expect(issues).toEqual(["setup.steps.1.fill.1: fill value is undefined — is the environment variable set?"]);
});

test("an unknown verb lists the verbs; a two-key step says one key", () => {
  const scen = (step: unknown) => issuesOf({ ...rfc4Base, scenarios: [{ id: "a", path: "/", steps: [step] }] });
  expect(scen({ tap: "x" })).toEqual([
    `scenarios.0.steps.0: unknown step "tap"; expected one of click, hover, fill, press, select, scroll, waitFor, wait, evaluate`,
  ]);
  expect(scen({ goto: "/x" })[0]).toMatch(/unknown step "goto"/);
  expect(scen({ click: "x", hover: "y" })).toEqual(["scenarios.0.steps.0: a step has exactly one key, got click, hover"]);
  expect(scen("click")[0]).toMatch(/^scenarios\.0\.steps\.0: a step is an object/);
  expect(scen({ wait: -1 })).toHaveLength(1);
  expect(issuesOf({ ...rfc4Base, setup: { steps: [{ tap: "x" }] } })[0]).toMatch(/expected one of click, .*, goto$/);
});

test("a scenario's viewports must be among the top-level viewports", () => {
  expect(issuesOf({ ...rfc4Base, viewports: [1280], scenarios: [{ id: "nav", path: "/", viewports: [375, 1280, 768] }] }))
    .toEqual([`scenarios.0.viewports: scenario "nav" viewports 375, 768 are not in the top-level viewports (1280)`]);
  expect(ConfigSchema.parse({ ...rfc4Base, viewports: [375, 1280], scenarios: [{ id: "nav", path: "/", viewports: [375] }] })
    .scenarios[0]!.viewports).toEqual([375]);
});

test("RFC-0006 settings default to the spec's values", () => {
  const c = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com" });
  expect(c.stabilize.waitForImages).toBe(true);
  expect(c.stabilize.reducedMotion).toBe("reduce");
  expect(c.stabilize.colorScheme).toBe("light");
  expect(c.stabilize.verify).toBe(false);
  expect(c.stabilize.clock).toBeUndefined();
  expect(c.retries).toBe(0);
  expect(c.diff.includeAA).toBe(false);
});

test("stabilize.clock must be a parseable date", () => {
  const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };
  expect(ConfigSchema.parse({ ...base, stabilize: { clock: "2026-01-01T00:00:00Z" } }).stabilize.clock).toBe("2026-01-01T00:00:00Z");
  const r = ConfigSchema.safeParse({ ...base, stabilize: { clock: "yesterday" } });
  expect(r.success).toBe(false);
  expect(r.error!.issues[0]!.message).toBe("stabilize.clock must be an ISO date, e.g. 2026-01-01T00:00:00Z");
});

test("retries is an integer from 0 to 10", () => {
  const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };
  expect(ConfigSchema.parse({ ...base, retries: 10 }).retries).toBe(10);
  expect(ConfigSchema.safeParse({ ...base, retries: 11 }).success).toBe(false);
  expect(ConfigSchema.safeParse({ ...base, retries: -1 }).success).toBe(false);
});
