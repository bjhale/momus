// tests/cli.test.ts
import { test, expect } from "bun:test";
import { parseCliArgs } from "../src/cli";

test("parses run subcommand with overrides", () => {
  const p = parseCliArgs(["run", "--dev", "https://d.com", "--concurrency", "8", "--crawl"]);
  expect(p.command).toBe("run");
  expect(p.overrides.dev).toBe("https://d.com");
  expect(p.overrides.concurrency).toBe(8);
  expect(p.overrides.crawl).toBe(true);
});

test("parses init and install-browser", () => {
  expect(parseCliArgs(["init"]).command).toBe("init");
  expect(parseCliArgs(["install-browser"]).command).toBe("install-browser");
});

test("unknown command yields help", () => {
  expect(parseCliArgs([]).command).toBe("help");
});
