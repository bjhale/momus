// tests/fixtures/db/make-v0.9.4.ts
// Regenerates v0.9.4.sqlite with the real v0.9.4 CLI. Not part of the suite.
//   git worktree add /tmp/momus-v094 v0.9.4
//   ln -s "$PWD/node_modules" /tmp/momus-v094/node_modules
//   bun tests/fixtures/db/make-v0.9.4.ts /tmp/momus-v094
//   git worktree remove /tmp/momus-v094
// Needs Chromium installed (`bun run src/cli.ts install-browser`).
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.argv[2];
if (!root) throw new Error("usage: bun make-v0.9.4.ts <path to a v0.9.4 checkout>");

const page = (title: string, bg = "#fff") => `<html><body style="margin:0;background:${bg}"><h1 style="font:20px sans-serif">${title}</h1></body></html>`;
const site = (port: number, pages: Record<string, string>) => Bun.serve({
  port,
  fetch: (req) => {
    const body = pages[new URL(req.url).pathname];
    return body === undefined ? new Response("not found", { status: 404 })
      : new Response(body, { headers: { "content-type": "text/html" } });
  },
});
// Dev differs from prod on /about (a whole-page background change, since a text
// tweak scores under failScore), so the stored run has one pass and one fail.
const prod = site(47801, { "/": page("Home"), "/about": page("About") });
const dev = site(47802, { "/": page("Home"), "/about": page("About us", "#c00") });

const work = mkdtempSync(join(tmpdir(), "momus-fixture-"));
try {
  writeFileSync(join(work, "urls.txt"), "/\n/about\n");
  writeFileSync(join(work, "momus.config.json"), JSON.stringify({
    dev: "http://localhost:47802", prod: "http://localhost:47801", viewports: [375],
    stabilize: { waitUntil: "load", settleMs: 0 },
    discovery: { urlList: "urls.txt", sitemap: false },
    output: { db: "momus.sqlite", report: "report.html" },
  }));
  // Async spawn: spawnSync would block this process's event loop, and with it
  // the two Bun.serve sites the CLI is trying to load.
  const cli = async (...args: string[]) => {
    const p = Bun.spawn(["bun", "run", join(root, "src/cli.ts"), ...args, "--config", "momus.config.json"],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    console.log(out, err);
    return code;
  };
  if (await cli("snapshot") !== 0) throw new Error("snapshot failed");
  if (await cli("run") !== 1) throw new Error("run should exit 1 (one failing page)");
  // Fold the WAL into the main file so one file is the whole fixture.
  const { Database } = await import("bun:sqlite");
  const db = new Database(join(work, "momus.sqlite"));
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
  db.close();
  copyFileSync(join(work, "momus.sqlite"), join(import.meta.dir, "v0.9.4.sqlite"));
} finally {
  prod.stop(); dev.stop();
  rmSync(work, { recursive: true, force: true });
}
