// tests/store/fixtures.test.ts
import { test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb, readBaselineImages, readComparisons } from "../../src/store/db";
import { LATEST_VERSION, userVersion } from "../../src/store/migrations";
import { runFlow } from "../../src/pipeline/run-flow";
import { ConfigSchema } from "../../src/config/schema";
import { exitCodeFor } from "../../src/pipeline/verdict";
import type { DiffResponse } from "../../src/diff/worker";
import { PNG } from "pngjs";

// RFC-0009: every 1.x release opens, migrates and diffs against a baseline
// written by any earlier release. Each checked-in DB under tests/fixtures/db
// is run here, with the config it was captured with beside it
// (vX.Y.Z.config.json); see tests/fixtures/db/README.md for adding one.
const DIR = join(import.meta.dir, "../fixtures/db");
const fixtures = readdirSync(DIR).filter((f) => /^v.*\.sqlite$/.test(f)).sort();

const tmp = mkdtempSync(join(import.meta.dir, ".tmp-fixtures-"));
const opened: Database[] = [];
afterAll(() => {
  for (const d of opened) { try { d.close(); } catch { /* already closed */ } }
  rmSync(tmp, { recursive: true, force: true });
});

test("there is at least one DB fixture", () => {
  expect(fixtures.length).toBeGreaterThan(0);
});

for (const name of fixtures) {
  test(`${name} migrates and diffs clean against itself`, async () => {
    const configFile = join(DIR, name.replace(/\.sqlite$/, ".config.json"));
    // A fixture without its config can't be diffed, so it can't be added untested.
    expect(existsSync(configFile)).toBe(true);
    const file = join(tmp, name);
    copyFileSync(join(DIR, name), file); // migration writes
    const db = openDb(file);
    opened.push(db);
    expect(userVersion(db)).toBe(LATEST_VERSION);

    const baseline = readBaselineImages(db);
    // The images themselves must survive migration, not just the rows: every
    // ok baseline image is still a decodable PNG.
    for (const im of baseline.filter((b) => b.status === "ok")) {
      expect(im.image?.length ?? 0).toBeGreaterThan(0);
      expect(PNG.sync.read(Buffer.from(im.image!)).width).toBeGreaterThan(0);
    }
    const byKey = new Map(baseline.map((im) => [`${im.targetId} ${im.viewport}`, im.image!]));
    const paths = [...new Set(baseline.filter((im) => im.source === "pages").map((im) => im.path))];
    const res = await runFlow({
      config: ConfigSchema.parse(JSON.parse(readFileSync(configFile, "utf8"))), db, now: "2030-01-01T00:00:00Z",
      discover: async () => paths,
      readUrlList: async () => paths.join("\n"),
      captureProd: async () => { throw new Error("a frozen baseline must not recapture prod"); },
      // Dev is the baseline itself: every comparison must pass.
      getDev: async (job) => {
        const png = byKey.get(`${job.targetId ?? job.path} ${job.viewport}`);
        if (!png) throw new Error(`no baseline image for ${job.targetId ?? job.path} @${job.viewport}`);
        return { ok: true, png };
      },
      diffPool: {
        submit: async (a: Uint8Array): Promise<DiffResponse> =>
          ({ id: 1, ok: true, width: 1, height: 1, diffPixels: 0, diffScore: 0, diffPng: a }),
        close: async () => {},
      },
    });
    expect(res.ok ? "ok" : res.conflict).toBe("ok");
    const rows = readComparisons(db, (res as { runId: number }).runId);
    expect(rows.length).toBe(baseline.length);
    expect(exitCodeFor(rows)).toBe(0);
  });
}
