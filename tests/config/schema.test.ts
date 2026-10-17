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
