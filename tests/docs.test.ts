// tests/docs.test.ts
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConfigSchema } from "../src/config/schema";
import { knownKeys } from "../src/config/suggest";
import { COMMAND_FLAGS } from "../src/cli";

// RFC-0009: the documentation covers every config field and every flag. These
// keep it that way: a new field or flag fails here until it is documented.
const doc = (name: string) => readFileSync(join(import.meta.dir, "../docs", name), "utf8");

/** Every dotted config path, arrays as `[]`: `scenarios[].capture.element`. */
function fieldPaths(): string[] {
  const out: string[] = [];
  const walk = (zodPath: (string | number)[], shown: string) => {
    for (const key of knownKeys(ConfigSchema as z.ZodTypeAny, zodPath)) {
      const name = shown ? `${shown}.${key}` : key;
      out.push(name);
      const child = [...zodPath, key];
      walk(child, name);
      if (knownKeys(ConfigSchema as z.ZodTypeAny, [...child, 0]).length) walk([...child, 0], `${name}[]`);
    }
  };
  walk([], "");
  return out;
}

test("docs/config.md names every config field", () => {
  const text = doc("config.md");
  const paths = fieldPaths();
  expect(paths).toContain("discovery.crawl.maxDepth");
  expect(paths).toContain("scenarios[].capture.element");
  expect(paths).toContain("setup.dev.storageState");
  const missing = paths.filter((p) => !text.includes(`\`${p}\``));
  expect(missing).toEqual([]);
});

test("docs/cli.md documents every command and its flags", () => {
  const text = doc("cli.md");
  for (const [command, flags] of Object.entries(COMMAND_FLAGS)) {
    const start = text.indexOf(`## \`momus ${command}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\n## ", start + 1);
    const section = text.slice(start, next < 0 ? undefined : next);
    const missing = flags.filter((f) => !section.includes(`\`--${f}`));
    expect({ command, missing }).toEqual({ command, missing: [] });
  }
});

test("the README links the reference docs", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  const missing = ["docs/cli.md", "docs/config.md", "docs/ci.md", "docs/stability.md"].filter((f) => !readme.includes(f));
  expect(missing).toEqual([]);
});
