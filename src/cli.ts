// src/cli.ts
import { parseArgs } from "node:util";
import type { CliOverrides } from "./config/load";
import type { CiMetadata } from "./store/db";

export interface ParsedCli {
  command: "run" | "snapshot" | "report" | "init" | "install-browser" | "help";
  overrides: CliOverrides;
  configPath?: string;
  /** `run --snapshot`: re-capture the prod baseline before diffing. Named
   * `forceSnapshot` internally so it never reads as the baseline row or the
   * `snapshot` command. */
  forceSnapshot?: boolean;
  /** `report --run`: which stored run to render; default the latest. */
  runId?: number;
  /** `run --commit/--branch/--pr`: recorded on the run (RFC-0002). */
  ci?: CiMetadata;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const command = (argv[0] ?? "help") as ParsedCli["command"];
  const known = new Set(["run", "snapshot", "report", "init", "install-browser"]);
  if (!known.has(command)) return { command: "help", overrides: {} };

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      dev: { type: "string" },
      prod: { type: "string" },
      out: { type: "string" },
      config: { type: "string" },
      concurrency: { type: "string" },
      crawl: { type: "boolean" },
      "max-pages": { type: "string" },
      insecure: { type: "boolean" },
      browser: { type: "string" },
      snapshot: { type: "boolean" },
      run: { type: "string" },
      "allow-added": { type: "boolean" },
      "allow-removed": { type: "boolean" },
      commit: { type: "string" },
      branch: { type: "string" },
      pr: { type: "string" },
      "report-images": { type: "string" },
    },
    allowPositionals: true,
  });

  // Flags are global (AGENTS.md); per-command validation is RFC-0009's job.
  // This one is rejected now because it reads like it does something.
  if (command === "snapshot" && values.snapshot) {
    throw new Error("unknown flag for snapshot: --snapshot (did you mean `momus run --snapshot`?)");
  }

  const overrides: CliOverrides = {};
  if (values.dev) overrides.dev = values.dev as string;
  if (values.prod) overrides.prod = values.prod as string;
  if (values.out) overrides.out = values.out as string;
  if (values.concurrency) overrides.concurrency = Number(values.concurrency);
  if (values["max-pages"]) overrides.maxPages = Number(values["max-pages"]);
  if (values.crawl) overrides.crawl = true;
  if (values.insecure) overrides.insecure = true;
  if (values.browser) overrides.browser = values.browser as string;
  if (values["allow-added"]) overrides.allowAdded = true;
  if (values["allow-removed"]) overrides.allowRemoved = true;
  if (values["report-images"]) overrides.reportImages = values["report-images"] as string;

  let runId: number | undefined;
  if (values.run !== undefined) {
    runId = Number(values.run);
    if (!Number.isInteger(runId) || runId < 1) throw new Error(`--run expects a positive run id, got "${values.run}"`);
  }

  const ci: CiMetadata = {};
  if (values.commit) ci.commit = values.commit as string;
  if (values.branch) ci.branch = values.branch as string;
  if (values.pr) ci.pr = values.pr as string;

  return {
    command, overrides, configPath: values.config as string | undefined,
    forceSnapshot: values.snapshot as boolean | undefined, runId,
    ci: Object.keys(ci).length ? ci : undefined,
  };
}

// --- Runtime dispatch (integration test covers it, not unit tests) ---
async function main(): Promise<void> {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    switch (parsed.command) {
      case "init": {
        const { runInit } = await import("./commands/init");
        const path = await runInit(process.cwd());
        console.log(`Created ${path}`);
        return;
      }
      case "install-browser": {
        const { installBrowser } = await import("./commands/install");
        process.exit(await installBrowser());
      }
      case "run": {
        const { runCommand } = await import("./commands/run");
        process.exit(await runCommand(parsed));
      }
      case "snapshot": {
        const { snapshotCommand } = await import("./commands/snapshot");
        process.exit(await snapshotCommand(parsed));
      }
      case "report": {
        const { reportCommand } = await import("./commands/report");
        process.exit(await reportCommand(parsed));
      }
      default:
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus snapshot [--prod URL] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure] [--browser NAME]\n  momus report [--run ID] [--out FILE] [--report-images MODE] [--config FILE]\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--max-pages N] [--crawl] [--insecure] [--browser NAME] [--snapshot] [--allow-added] [--allow-removed] [--report-images MODE] [--commit SHA] [--branch NAME] [--pr N]`);
        process.exit(0);
    }
  } catch (err) {
    // init's "already exists" and parseArgs' unknown-flag errors should surface
    // as a clean one-line message, not a raw stack trace.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

if (import.meta.main) await main();
