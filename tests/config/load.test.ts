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
