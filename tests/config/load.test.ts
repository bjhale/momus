// tests/config/load.test.ts
import { test, expect } from "bun:test";
import { resolveConfig } from "../../src/config/load";

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
