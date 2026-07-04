// src/cli.ts
import { parseArgs } from "node:util";
import type { CliOverrides } from "./config/load";

export interface ParsedCli {
  command: "run" | "init" | "install-browser" | "help";
  overrides: CliOverrides;
  configPath?: string;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const command = (argv[0] ?? "help") as ParsedCli["command"];
  const known = new Set(["run", "init", "install-browser"]);
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
    },
    allowPositionals: true,
  });

  const overrides: CliOverrides = {};
  if (values.dev) overrides.dev = values.dev as string;
  if (values.prod) overrides.prod = values.prod as string;
  if (values.out) overrides.out = values.out as string;
  if (values.concurrency) overrides.concurrency = Number(values.concurrency);
  if (values.crawl) overrides.crawl = true;

  return { command, overrides, configPath: values.config as string | undefined };
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
      default:
        console.log(`momus — visual regression diff\n\nUsage:\n  momus init\n  momus install-browser\n  momus run [--dev URL] [--prod URL] [--out FILE] [--config FILE] [--concurrency N] [--crawl]`);
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
