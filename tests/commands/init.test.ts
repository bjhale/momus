// tests/commands/init.test.ts
import { test, expect } from "bun:test";
import { configScaffold } from "../../src/commands/init";

test("scaffold is valid TS exporting a defineConfig call", () => {
  const s = configScaffold();
  expect(s).toContain("defineConfig");
  expect(s).toContain("dev:");
  expect(s).toContain("prod:");
  expect(s).toContain("viewports");
});
