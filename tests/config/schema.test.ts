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
