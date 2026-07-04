// tests/commands/init.test.ts
import { test, expect } from "bun:test";
import { configScaffold } from "../../src/commands/init";

test("scaffold is a plain default-exported config with the key fields", () => {
  const s = configScaffold();
  expect(s).toContain("export default {");
  expect(s).toContain("dev:");
  expect(s).toContain("prod:");
  expect(s).toContain("viewports");
});

test("scaffold does not import from 'momus' (must run standalone / in Docker)", () => {
  // A bare `from "momus"` import would fail to resolve when the config runs
  // where the momus package isn't importable (e.g. inside the container).
  expect(configScaffold()).not.toContain('from "momus"');
});

test("scaffold parses and validates against the config schema", async () => {
  const { ConfigSchema } = await import("../../src/config/schema");
  // Write the scaffold to a temp file, import it as a module, validate the
  // default export — proving `momus init` produces a runnable, valid config.
  const dir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(`${import.meta.dir}/.tmp-init-`));
  const file = `${dir}/momus.config.ts`;
  try {
    await Bun.write(file, configScaffold());
    const mod = await import(file);
    expect(() => ConfigSchema.parse(mod.default)).not.toThrow();
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
  }
});
