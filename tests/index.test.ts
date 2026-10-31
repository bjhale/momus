// tests/index.test.ts
import { test, expect } from "bun:test";

// Whatever src/index.ts exports at 1.0 is supported for all of 1.x
// (RFC-0009, ADR-0041). Adding an export is a contract change: update this,
// the ADR and docs/stability.md together.
test("the package exports exactly the 1.x API", async () => {
  expect(Object.keys(await import("../src/index")).sort()).toEqual(["defineConfig"]);
});
