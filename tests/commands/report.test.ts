// tests/commands/report.test.ts
import { test, expect, afterEach, spyOn, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { reportCommand } from "../../src/commands/report";
import { parseCliArgs } from "../../src/cli";
import { openDb, startRun, saveComparison, finishRun } from "../../src/store/db";

let dir = "";
afterEach(() => { mock.restore(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

function project(): { cfg: string; db: string; out: string } {
  dir = mkdtempSync(join(import.meta.dir, ".tmp-report-cmd-"));
  const db = join(dir, "m.sqlite"), out = join(dir, "r.html"), cfg = join(dir, "momus.config.json");
  writeFileSync(cfg, JSON.stringify({ dev: "https://d.example.com", prod: "https://p.example.com", output: { db, report: out } }));
  return { cfg, db, out };
}
function seed(dbPath: string, n: number): number[] {
  const db = openDb(dbPath);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: `t${i}` });
    saveComparison(db, id, { path: `/${i}`, viewport: 1280, devUrl: "d", prodUrl: "p", status: "ok", diffScore: 0, passed: true });
    finishRun(db, id, "complete", "f");
    ids.push(id);
  }
  db.close();
  return ids;
}
const quiet = () => { spyOn(console, "log").mockImplementation(() => {}); spyOn(console, "error").mockImplementation(() => {}); };

test("renders the latest run by default", async () => {
  quiet();
  const p = project();
  const ids = seed(p.db, 2);
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg]))).toBe(0);
  const html = await Bun.file(p.out).text();
  expect(html).toContain(`run #${ids[1]}`);
  expect(html).toContain("/1");
});

test("--run renders an older run", async () => {
  quiet();
  const p = project();
  const ids = seed(p.db, 2);
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg, "--run", String(ids[0])]))).toBe(0);
  expect(await Bun.file(p.out).text()).toContain(`run #${ids[0]}`);
});

test("an unknown run id exits 2 and lists the available ids", async () => {
  const p = project();
  seed(p.db, 2);
  spyOn(console, "log").mockImplementation(() => {});
  const err = spyOn(console, "error").mockImplementation(() => {});
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg, "--run", "99"]))).toBe(2);
  expect(String(err.mock.calls.at(-1)?.[0])).toContain("Available: 1, 2");
});

test("a missing DB exits 2 without creating one", async () => {
  quiet();
  const p = project();
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg]))).toBe(2);
  expect(existsSync(p.db)).toBe(false);
});

test("a DB with no runs exits 2", async () => {
  quiet();
  const p = project();
  openDb(p.db).close();
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg]))).toBe(2);
});

test("a failed run still renders (exit 0) but warns on stderr with its status", async () => {
  const p = project();
  const db = openDb(p.db);
  const id = startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "t" });
  finishRun(db, id, "failed", "f");
  db.close();
  spyOn(console, "log").mockImplementation(() => {});
  const err = spyOn(console, "error").mockImplementation(() => {});
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg]))).toBe(0);
  expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(new RegExp(`run #${id}.*failed`));
  const html = await Bun.file(p.out).text();
  expect(html).toContain("momus — FAIL");
});

test("a complete run does not warn", async () => {
  const p = project();
  seed(p.db, 1);
  spyOn(console, "log").mockImplementation(() => {});
  const err = spyOn(console, "error").mockImplementation(() => {});
  expect(await reportCommand(parseCliArgs(["report", "--config", p.cfg]))).toBe(0);
  expect(err).not.toHaveBeenCalled();
});
