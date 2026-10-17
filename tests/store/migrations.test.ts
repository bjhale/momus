// tests/store/migrations.test.ts
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb as openDbRaw } from "../../src/store/db";
import { MIGRATIONS, LATEST_VERSION, migrate, userVersion, DbTooNewError, type Migration } from "../../src/store/migrations";

let dir = "";
const opened: Database[] = [];
const track = (d: Database): Database => { opened.push(d); return d; };
const openDb = (path: string): Database => track(openDbRaw(path));
afterEach(() => {
  for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
function tmpFile(name = "t.sqlite"): string {
  dir = mkdtempSync(join(import.meta.dir, ".tmp-migrations-"));
  return join(dir, name);
}
const tables = (db: Database): string[] =>
  (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

test("migration versions are 1..N with no gaps", () => {
  expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  expect(LATEST_VERSION).toBe(MIGRATIONS.length);
});

test("a fresh DB is created through the same chain and lands on the latest version", () => {
  const db = openDb(":memory:");
  expect(userVersion(db)).toBe(LATEST_VERSION);
  expect(tables(db)).toEqual(["baseline_images", "comparisons", "runs", "snapshot"]);
});

test("a pre-versioning DB (user_version 0, tables present) is migrated forward", () => {
  const file = tmpFile();
  const raw = new Database(file, { create: true });
  raw.exec(`CREATE TABLE snapshot (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, prod_base_url TEXT NOT NULL,
    viewports_json TEXT NOT NULL, stabilize_json TEXT NOT NULL, config_json TEXT NOT NULL);`);
  raw.close();
  const db = openDb(file);
  expect(userVersion(db)).toBe(LATEST_VERSION);
  expect(tables(db)).toEqual(["baseline_images", "comparisons", "runs", "snapshot"]);
});

test("opening twice is a no-op the second time", () => {
  const file = tmpFile();
  openDb(file).close();
  const db = openDb(file);
  expect(userVersion(db)).toBe(LATEST_VERSION);
});

test("a DB from a newer momus is refused and its bytes are untouched", () => {
  const file = tmpFile();
  const raw = new Database(file, { create: true });
  raw.exec("CREATE TABLE future (x);");
  raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 1};`);
  raw.close();
  const before = readFileSync(file);
  expect(() => openDb(file)).toThrow(DbTooNewError);
  expect(() => openDb(file)).toThrow(/newer momus/);
  expect(readFileSync(file).equals(before)).toBe(true);
  expect(() => readFileSync(`${file}-wal`)).toThrow(); // never switched to WAL
});

test("a failing migration rolls back its own step and keeps earlier ones", () => {
  const db = track(new Database(":memory:"));
  const steps: Migration[] = [
    { version: 1, up: (d) => d.exec("CREATE TABLE a (x);") },
    { version: 2, up: (d) => { d.exec("CREATE TABLE b (x);"); throw new Error("boom"); } },
  ];
  expect(() => migrate(db, steps)).toThrow("boom");
  expect(userVersion(db)).toBe(1);
  expect(tables(db)).toEqual(["a"]);
});

test("migrate refuses a version newer than the list it was given", () => {
  const db = track(new Database(":memory:"));
  db.exec("PRAGMA user_version = 9;");
  expect(() => migrate(db, MIGRATIONS)).toThrow(DbTooNewError);
});
