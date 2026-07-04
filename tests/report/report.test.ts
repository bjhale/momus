// tests/report/report.test.ts
import { test, expect } from "bun:test";
import { openDb, startRun, saveComparison, finishRun } from "../../src/store/db";
import { writeReport } from "../../src/report/report";

test("writeReport reads DB and writes an HTML file", async () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "https://dev", prodBaseUrl: "https://prod", configJson: "{}", startedAt: "t" });
  saveComparison(db, runId, {
    path: "/", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1, height: 1, diffPixels: 0, diffScore: 0, passed: true, status: "ok",
  });
  finishRun(db, runId, "complete", "t2");

  const out = `${import.meta.dir}/.tmp-report.html`;
  await writeReport(db, runId, out);
  const html = await Bun.file(out).text();
  expect(html).toContain("<title>momus report</title>");
  await Bun.file(out).delete();
});
