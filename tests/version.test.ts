// tests/version.test.ts
import { test, expect } from "bun:test";
import { MOMUS_VERSION } from "../src/version";

test("MOMUS_VERSION is package.json's semver", () => {
  expect(MOMUS_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  expect(MOMUS_VERSION).not.toBe("0.1.0"); // the stale pre-0.9 value
});
