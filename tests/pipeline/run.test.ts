// tests/pipeline/run.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { runPipeline } from "../../src/pipeline/run";
import { openDb, readComparisons } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";

function png(w: number, h: number, v: number): Uint8Array {
  const p = new PNG({ width: w, height: h }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

test("pipeline captures, diffs, and persists for each path×viewport", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com",
    viewports: [1280],
  });
  const db = openDb(":memory:");

  await runPipeline({
    config, db, startedAt: "2026-07-03T00:00:00Z", finishedAt: "2026-07-03T00:01:00Z",
    // Inject fakes for the browser-touching + discovery seams:
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(4, 4, 100) }),
    diffPool: {
      submit: async (a: Uint8Array) =>
        ({ id: 1, ok: true, width: 4, height: 4, diffPixels: 0, diffScore: 0, diffPng: a }),
      close: async () => {},
    },
  });

  const rows = readComparisons(db, 1);
  expect(rows.length).toBe(2); // 2 paths × 1 viewport
  for (const r of rows) expect(r.status).toBe("ok");
});
