// tests/diff/pool.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { DiffPool } from "../../src/diff/pool";

function pngBuffer(w: number, h: number, v: number): Uint8Array {
  const png = new PNG({ width: w, height: h });
  png.data.fill(v);
  return new Uint8Array(PNG.sync.write(png));
}

test("pool processes more jobs than workers", async () => {
  const pool = new DiffPool(2);
  const jobs = Array.from({ length: 5 }, (_, i) =>
    pool.submit(pngBuffer(8, 8, 255), pngBuffer(8, 8, i * 10), 0.1));
  const results = await Promise.all(jobs);
  expect(results.length).toBe(5);
  for (const r of results) expect(r.ok).toBe(true);
  await pool.close();
});
