// tests/config/redact.test.ts
import { test, expect } from "bun:test";
import { ConfigSchema } from "../../src/config/schema";
import { redactConfig, setupIdentity } from "../../src/config/redact";

const base = { dev: "https://dev.example.com", prod: "https://www.example.com" };
const login = (user: string, pass: string) => ({ steps: [
  { goto: "/login" }, { fill: ["#email", user] }, { fill: ["#password", pass] }, { click: "button" }] });

test("no setup → null identity, config unchanged", () => {
  const c = ConfigSchema.parse(base);
  expect(setupIdentity(c)).toBeNull();
  expect(redactConfig(c)).toBe(c);
});

test("identity is prod's setup with fill values removed", () => {
  const c = ConfigSchema.parse({ ...base, setup: { dev: login("d", "dpass"), prod: login("p", "hunter2") } });
  const id = setupIdentity(c)!;
  expect(id).not.toContain("hunter2");
  expect(id).not.toContain('"p"');
  expect(id).toContain("#password");
  // dev's setup is not part of it
  const otherDev = ConfigSchema.parse({ ...base, setup: { dev: login("x", "y"), prod: login("p", "hunter2") } });
  expect(setupIdentity(otherDev)).toBe(id);
});

test("rotating a password or moving the storageState file keeps the identity", () => {
  const a = ConfigSchema.parse({ ...base, setup: login("p", "old") });
  const b = ConfigSchema.parse({ ...base, setup: login("p", "new") });
  expect(setupIdentity(a)).toBe(setupIdentity(b));
  const s1 = ConfigSchema.parse({ ...base, setup: { storageState: "a.json" } });
  const s2 = ConfigSchema.parse({ ...base, setup: { storageState: "b.json" } });
  expect(setupIdentity(s1)).toBe(setupIdentity(s2));
});

test("a changed login flow changes the identity", () => {
  const a = ConfigSchema.parse({ ...base, setup: login("p", "x") });
  const b = ConfigSchema.parse({ ...base, setup: { steps: [...login("p", "x").steps, { waitFor: "#menu" }] } });
  expect(setupIdentity(a)).not.toBe(setupIdentity(b));
});

test("redactConfig removes every setup secret from the stored config", () => {
  const c = ConfigSchema.parse({ ...base, setup: { dev: login("d", "devsecret"), prod: { storageState: "prod.json" } } });
  const json = JSON.stringify(redactConfig(c));
  expect(json).not.toContain("devsecret");
  expect(json).not.toContain("prod.json");
  expect(ConfigSchema.parse(redactConfig(c))).toBeDefined(); // still a valid config shape
});
