// tests/cli.test.ts
import { test, expect } from "bun:test";
import { parseCliArgs, usage, COMMAND_FLAGS } from "../src/cli";

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

test("parses --commit, --branch and --pr into CI metadata", () => {
  expect(parseCliArgs(["run", "--commit", "abc123", "--branch", "main", "--pr", "42"]).ci)
    .toEqual({ commit: "abc123", branch: "main", pr: "42" });
  expect(parseCliArgs(["run", "--branch", "x"]).ci).toEqual({ branch: "x" });
  expect(parseCliArgs(["run"]).ci).toBeUndefined();
});

test("snapshot --snapshot is an error, not a silent no-op", () => {
  expect(() => parseCliArgs(["snapshot", "--snapshot"])).toThrow("unknown flag for snapshot: --snapshot (it is a flag of run)");
  expect(parseCliArgs(["run", "--snapshot"]).forceSnapshot).toBe(true);
});

test("parses --report-images", () => {
  expect(parseCliArgs(["report", "--report-images", "thumbnails"]).overrides.reportImages).toBe("thumbnails");
  expect(parseCliArgs(["run"]).overrides.reportImages).toBeUndefined();
});

// --- RFC-0009: flags are validated per command (ADR-0039) ---

test("every command rejects a flag it doesn't take, naming the commands that do", () => {
  expect(() => parseCliArgs(["snapshot", "--dev", "https://d.com"])).toThrow("unknown flag for snapshot: --dev (it is a flag of run)");
  expect(() => parseCliArgs(["report", "--crawl"])).toThrow("unknown flag for report: --crawl (it is a flag of run, snapshot)");
  expect(() => parseCliArgs(["init", "--config", "x.ts"])).toThrow("unknown flag for init: --config (it is a flag of run, snapshot, report)");
  expect(() => parseCliArgs(["install-browser", "--browser", "webkit"])).toThrow("unknown flag for install-browser: --browser");
});

test("a flag no command takes is unknown everywhere", () => {
  expect(() => parseCliArgs(["run", "--nope"])).toThrow(/^unknown flag for run: --nope$/);
});

test("positional arguments are an error", () => {
  expect(() => parseCliArgs(["run", "extra"])).toThrow("unexpected argument for run: extra");
});

test("flags shared by commands parse on each", () => {
  expect(parseCliArgs(["snapshot", "--prod", "https://p.com"]).overrides.prod).toBe("https://p.com");
  expect(parseCliArgs(["report", "--config", "c.ts"]).configPath).toBe("c.ts");
  expect(parseCliArgs(["run", "--report-images", "link"]).overrides.reportImages).toBe("link");
});

test("the usage text lists each command's flags", () => {
  const text = usage();
  for (const [command, flags] of Object.entries(COMMAND_FLAGS)) {
    const line = text.split("\n").find((l) => l.trim().startsWith(`momus ${command}`))!;
    expect(line).toBeDefined();
    for (const f of flags) expect(line).toContain(`--${f}`);
  }
});

test("--help or -h after any command shows the usage", () => {
  expect(parseCliArgs(["run", "--help"]).command).toBe("help");
  expect(parseCliArgs(["snapshot", "-h"]).command).toBe("help");
  expect(parseCliArgs(["report", "--run", "3", "--help"]).command).toBe("help");
});
