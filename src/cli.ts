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

type Command = Exclude<ParsedCli["command"], "help">;

/** Every flag, with its type and the placeholder the usage text shows. */
const FLAGS = {
  dev: { type: "string", arg: "URL" },
  prod: { type: "string", arg: "URL" },
  out: { type: "string", arg: "FILE" },
  config: { type: "string", arg: "FILE" },
  concurrency: { type: "string", arg: "N" },
  "max-pages": { type: "string", arg: "N" },
  crawl: { type: "boolean" },
  insecure: { type: "boolean" },
  browser: { type: "string", arg: "NAME" },
  snapshot: { type: "boolean" },
  run: { type: "string", arg: "ID" },
  "allow-added": { type: "boolean" },
  "allow-removed": { type: "boolean" },
  "report-images": { type: "string", arg: "MODE" },
  commit: { type: "string", arg: "SHA" },
  branch: { type: "string", arg: "NAME" },
  pr: { type: "string", arg: "N" },
} as const satisfies Record<string, { type: "string" | "boolean"; arg?: string }>;
type Flag = keyof typeof FLAGS;

/** The flags each command takes. Anything else is an error, so a flag can't
 * be silently ignored by a command that doesn't read it (RFC-0009, ADR-0039). */
export const COMMAND_FLAGS: Record<Command, readonly Flag[]> = {
  run: ["dev", "prod", "out", "config", "concurrency", "max-pages", "crawl", "insecure", "browser", "snapshot",
    "allow-added", "allow-removed", "report-images", "commit", "branch", "pr"],
  snapshot: ["prod", "config", "concurrency", "max-pages", "crawl", "insecure", "browser"],
  report: ["run", "out", "report-images", "config"],
  init: [],
  "install-browser": [],
};

export function usage(): string {
  const line = (c: Command) => `  momus ${c}` + COMMAND_FLAGS[c].map((f) => {
    const d = FLAGS[f] as { arg?: string };
    return ` [--${f}${d.arg ? ` ${d.arg}` : ""}]`;
  }).join("");
  const order: Command[] = ["init", "install-browser", "snapshot", "report", "run"];
  return `momus — visual regression diff\n\nUsage:\n${order.map(line).join("\n")}`;
}

/** parseArgs' errors name neither the command nor what to use instead. */
function argError(command: Command, err: unknown): Error {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const flag = /'(-[^']*)'/.exec(msg)?.[1] ?? msg;
    const name = flag.replace(/^-+/, "");
    const owners = (Object.keys(COMMAND_FLAGS) as Command[])
      .filter((c) => (COMMAND_FLAGS[c] as readonly string[]).includes(name));
    return new Error(`unknown flag for ${command}: ${flag}${owners.length ? ` (it is a flag of ${owners.join(", ")})` : ""}`);
  }
  if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
    const arg = /'([^']*)'/.exec(msg)?.[1] ?? msg;
    return new Error(`unexpected argument for ${command}: ${arg}`);
  }
  return err instanceof Error ? err : new Error(msg);
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const arg0 = argv[0] ?? "help";
  if (!Object.hasOwn(COMMAND_FLAGS, arg0)) return { command: "help", overrides: {} };
  const command = arg0 as Command;

  let values: Partial<Record<Flag, string | boolean>>;
  try {
    values = parseArgs({
      args: argv.slice(1),
      options: Object.fromEntries(COMMAND_FLAGS[command].map((f) => [f, { type: FLAGS[f].type }])),
      strict: true,
      allowPositionals: false,
    }).values as Partial<Record<Flag, string | boolean>>;
  } catch (err) {
    throw argError(command, err);
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
        console.log(usage());
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
