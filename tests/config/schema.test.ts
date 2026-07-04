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
