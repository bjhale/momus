// tests/config/suggest.test.ts
import { test, expect } from "bun:test";
import { suggest, knownKeys } from "../../src/config/suggest";
import { ConfigSchema } from "../../src/config/schema";

test("suggest picks the closest key, ignoring case", () => {
  expect(suggest("viewport", ["viewports", "dev", "prod"])).toBe("viewports");
  expect(suggest("FAILSCORE", ["failScore", "threshold"])).toBe("failScore");
  expect(suggest("maks", ["mask", "remove"])).toBe("mask");
});

test("suggest gives nothing when no key is close", () => {
  expect(suggest("zzzzzz", ["viewports", "dev"])).toBeUndefined();
  expect(suggest("db", ["report"])).toBeUndefined();
});

test("knownKeys walks defaults, arrays, unions and transforms", () => {
  expect(knownKeys(ConfigSchema, [])).toContain("viewports");
  expect(knownKeys(ConfigSchema, ["stabilize"])).toContain("waitForImages");
  expect(knownKeys(ConfigSchema, ["discovery", "crawl"]).sort()).toEqual(["enabled", "maxDepth", "startPath"]);
  expect(knownKeys(ConfigSchema, ["diff", "overrides", 0]).sort()).toEqual(["failScore", "path"]);
  expect(knownKeys(ConfigSchema, ["scenarios", 3])).toContain("capture");
  expect(knownKeys(ConfigSchema, ["setup", "dev"]).sort()).toEqual(["steps", "storageState"]);
});
