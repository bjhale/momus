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

test("parses snapshot subcommand with overrides", () => {
  const p = parseCliArgs(["snapshot", "--prod", "https://p.com", "--concurrency", "4", "--crawl"]);
  expect(p.command).toBe("snapshot");
  expect(p.overrides.prod).toBe("https://p.com");
  expect(p.overrides.concurrency).toBe(4);
  expect(p.overrides.crawl).toBe(true);
});

test("parses --max-pages into overrides", () => {
  const p = parseCliArgs(["run", "--max-pages", "50"]);
  expect(p.overrides.maxPages).toBe(50);
});

test("parses --insecure", () => {
  expect(parseCliArgs(["run", "--insecure"]).overrides.insecure).toBe(true);
  expect(parseCliArgs(["run"]).overrides.insecure).toBeUndefined();
});

test("--browser flag is parsed into overrides", () => {
  const parsed = parseCliArgs(["run", "--browser", "webkit"]);
  expect(parsed.overrides.browser).toBe("webkit");
});

test("parses --snapshot into a run-mode flag (not a config override)", () => {
  expect(parseCliArgs(["run", "--snapshot"]).forceSnapshot).toBe(true);
  expect(parseCliArgs(["run"]).forceSnapshot).toBeUndefined();
});

test("parses --allow-added and --allow-removed", () => {
  const p = parseCliArgs(["run", "--allow-added", "--allow-removed"]);
  expect(p.overrides.allowAdded).toBe(true);
  expect(p.overrides.allowRemoved).toBe(true);
  expect(parseCliArgs(["run"]).overrides.allowAdded).toBeUndefined();
});

test("parses report with --run", () => {
  const p = parseCliArgs(["report", "--run", "3", "--out", "r.html"]);
  expect(p.command).toBe("report");
  expect(p.runId).toBe(3);
  expect(p.overrides.out).toBe("r.html");
  expect(parseCliArgs(["report"]).runId).toBeUndefined();
});

test("--run must be a positive integer", () => {
  expect(() => parseCliArgs(["report", "--run", "abc"])).toThrow("--run");
  expect(() => parseCliArgs(["report", "--run", "0"])).toThrow("--run");
});
