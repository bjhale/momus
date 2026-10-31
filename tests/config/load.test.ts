// tests/config/load.test.ts
import { test, expect } from "bun:test";
import { resolveConfig, loadConfigFile } from "../../src/config/load";
import { writeFileSync, rmSync } from "node:fs";

const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };

test("CLI flags override file values", () => {
  const c = resolveConfig(base, {
    dev: "https://override-dev.com",
    out: "custom.html",
    concurrency: 12,
    crawl: true,
  });
  expect(c.dev).toBe("https://override-dev.com");
  expect(c.output.report).toBe("custom.html");
  expect(c.concurrency.screenshots).toBe(12); // --concurrency maps to screenshots only
  expect(c.concurrency.diffWorkers).toBe(4);  // untouched
  expect(c.discovery.crawl.enabled).toBe(true);
});

test("no overrides yields file + defaults", () => {
  const c = resolveConfig(base, {});
  expect(c.dev).toBe("https://dev.example.com");
  expect(c.output.report).toBe("momus-report.html");
});

test("--max-pages overrides discovery.maxPages", () => {
  const c = resolveConfig(base, { maxPages: 42 });
  expect(c.discovery.maxPages).toBe(42);
});

test("maxPages 0 override is honored (not treated as absent)", () => {
  const c = resolveConfig(base, { maxPages: 0 });
  expect(c.discovery.maxPages).toBe(0);
});

test("loadConfigFile loads a JSON config via a cwd-relative path", async () => {
  // Relative to process.cwd() (repo root), NOT relative to load.ts.
  const relPath = "momus.test-fixture.config.json";
  writeFileSync(relPath, JSON.stringify({ dev: "https://d.com", prod: "https://p.com" }));
  try {
    const raw = await loadConfigFile(relPath);
    expect(raw.dev).toBe("https://d.com");
    expect(raw.prod).toBe("https://p.com");
  } finally {
    rmSync(relPath, { force: true });
  }
});

test("--crawl forces enabled while preserving existing crawl object fields", () => {
  const c = resolveConfig(
    { ...base, discovery: { crawl: { enabled: false, maxDepth: 5 } } },
    { crawl: true },
  );
  expect(c.discovery.crawl).toEqual({ enabled: true, startPath: "/", maxDepth: 5 });
});

test("--insecure overrides config.insecure (CLI wins)", () => {
  expect(resolveConfig(base, { insecure: true }).insecure).toBe(true);
  expect(resolveConfig({ ...base, insecure: false }, { insecure: true }).insecure).toBe(true);
  expect(resolveConfig(base, {}).insecure).toBe(false); // default
});

test("--browser overrides the config-file browser value", () => {
  const c = resolveConfig({ ...base, browser: "chromium" }, { browser: "firefox" });
  expect(c.browser).toBe("firefox");
});

test("browser falls back to the file value when no override", () => {
  const c = resolveConfig({ ...base, browser: "webkit" }, {});
  expect(c.browser).toBe("webkit");
});

test("--allow-added / --allow-removed override diff.allowAdded / allowRemoved", () => {
  const c = resolveConfig({ ...base, diff: { failScore: 0.05 } }, { allowAdded: true, allowRemoved: true });
  expect(c.diff.allowAdded).toBe(true);
  expect(c.diff.allowRemoved).toBe(true);
  expect(c.diff.failScore).toBe(0.05); // sibling diff fields untouched
});

test("config errors are readable lines, one per issue, not ZodError JSON", () => {
  let message = "";
  try {
    resolveConfig({ ...base, viewports: [0], setup: { steps: [{ goto: "/login" }, { fill: ["#password", undefined as unknown as string] }] } }, {});
  } catch (err) {
    message = (err as Error).message;
  }
  expect(message.split("\n")).toEqual([
    "viewports.0: Number must be greater than 0",
    "setup.steps.1.fill.1: fill value is undefined — is the environment variable set?",
  ]);
});

test("--report-images beats output.reportImages, and an unknown mode is a config error", () => {
  expect(resolveConfig({ ...base, output: { reportImages: "link" } }, { reportImages: "thumbnails" }).output.reportImages)
    .toBe("thumbnails");
  expect(resolveConfig({ ...base, output: { reportImages: "link" } }, {}).output.reportImages).toBe("link");
  expect(() => resolveConfig(base, { reportImages: "big" })).toThrow(/^output\.reportImages: /);
});

// --- RFC-0009: unknown config keys are rejected (ADR-0040) ---

const bad = (extra: Record<string, unknown>) => () => resolveConfig({ ...base, ...extra } as never, {});

test("an unknown top-level key fails with a suggestion", () => {
  expect(bad({ viewport: [375] })).toThrow('viewport: unknown key; did you mean "viewports"?');
});

test("unknown nested keys name their full path and suggest", () => {
  expect(bad({ stabilize: { maks: [] } })).toThrow('stabilize.maks: unknown key; did you mean "mask"?');
  expect(bad({ discovery: { crawl: { maxdepth: 2 } } })).toThrow('discovery.crawl.maxdepth: unknown key; did you mean "maxDepth"?');
  expect(bad({ diff: { overrides: [{ path: "/a", failscore: 0.1 }] } }))
    .toThrow('diff.overrides.0.failscore: unknown key; did you mean "failScore"?');
  expect(bad({ scenarios: [{ id: "a", path: "/", stepz: [] }] })).toThrow('scenarios.0.stepz: unknown key; did you mean "steps"?');
  expect(bad({ output: { reportImage: "link" } })).toThrow('output.reportImage: unknown key; did you mean "reportImages"?');
});

test("nothing close: no suggestion", () => {
  expect(bad({ zzzzzz: 1 })).toThrow(/^zzzzzz: unknown key$/m);
});

test("a resolved config re-parses under strict", async () => {
  const { applyDefaults } = await import("../../src/config/schema");
  const full = resolveConfig({
    ...base, discovery: { crawl: { maxDepth: 2 } },
    setup: { dev: { storageState: "d.json" }, prod: { storageState: "p.json" } },
    scenarios: [{ id: "a", path: "/", steps: [{ click: "#m" }] }],
  }, {});
  expect(() => applyDefaults(full)).not.toThrow();
});
