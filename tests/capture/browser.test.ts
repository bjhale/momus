// tests/capture/browser.test.ts
import { test, expect } from "bun:test";
import { isBrowserInstalled } from "../../src/capture/browser";

test("isBrowserInstalled returns a boolean", () => {
  // We can't guarantee install state in CI; just assert the contract.
  expect(typeof isBrowserInstalled()).toBe("boolean");
});
