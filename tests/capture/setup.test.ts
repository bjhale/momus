// tests/capture/setup.test.ts
import { test, expect } from "bun:test";
import type { Browser } from "playwright-core";
import { ConfigSchema } from "../../src/config/schema";
import { runSetup, SetupError } from "../../src/capture/setup";

const noBrowser = {} as Browser;
const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };

test("no setup: no session", async () => {
  expect(await runSetup(noBrowser, "dev", ConfigSchema.parse(base))).toBeUndefined();
});

test("storageState is read from the side's file", async () => {
  const config = ConfigSchema.parse({ ...base, setup: { dev: { storageState: "dev.json" }, prod: { storageState: "prod.json" } } });
  const state = { cookies: [], origins: [] };
  const read = async (p: string) => { expect(p).toBe("prod.json"); return JSON.stringify(state); };
  expect(await runSetup(noBrowser, "prod", config, read)).toEqual(state);
});

test("an unreadable storageState is a SetupError naming side and file", async () => {
  const config = ConfigSchema.parse({ ...base, setup: { storageState: "auth.json" } });
  const err = await runSetup(noBrowser, "dev", config, async () => { throw new Error("ENOENT"); }).catch((e) => e);
  expect(err).toBeInstanceOf(SetupError);
  expect(err.message).toBe('setup (dev) storageState "auth.json": ENOENT');
});

test("invalid JSON in storageState fails with a fixed reason, not the file text", async () => {
  const config = ConfigSchema.parse({ ...base, setup: { storageState: "auth.json" } });
  const err = await runSetup(noBrowser, "dev", config, async () => "{ secret-token").catch((e) => e);
  expect(err).toBeInstanceOf(SetupError);
  expect(err.message).toBe('setup (dev) storageState "auth.json": not valid JSON');
  expect(err.message).not.toContain("secret-token");
});

test("a storageState of the wrong shape fails setup once", async () => {
  const config = ConfigSchema.parse({ ...base, setup: { storageState: "auth.json" } });
  const err = await runSetup(noBrowser, "dev", config, async () => "{}").catch((e) => e);
  expect(err).toBeInstanceOf(SetupError);
  expect(err.message).toBe('setup (dev) storageState "auth.json": expected { cookies: [], origins: [] }');
});
