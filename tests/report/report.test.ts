// tests/report/report.test.ts
import { test, expect } from "bun:test";
import { openDb, startRun, saveComparison, finishRun } from "../../src/store/db";
import { writeReport } from "../../src/report/report";
import { rmSync } from "node:fs";

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

test("writeReport uses the gate stored with the run, not the caller's", async () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "https://dev", prodBaseUrl: "https://prod", configJson: "{}", startedAt: "2026-10-17T09:00:00Z", allowAdded: true });
  saveComparison(db, runId, { path: "/new", viewport: 1280, devUrl: "d", prodUrl: "p", status: "added", devImage: new Uint8Array([1]) });
  finishRun(db, runId, "complete", "t2");
  const out = `${import.meta.dir}/.tmp-report-gate.html`;
  try {
    await writeReport(db, runId, out);
    const html = await Bun.file(out).text();
    expect(html).toContain('<header class="PASS">');
    expect(html).toContain(`run #${runId}`);
    expect(html).toContain("2026-10-17T09:00:00Z");
  } finally {
    await Bun.file(out).delete().catch(() => {});
  }
});

test("writeReport in link mode writes images next to the report", async () => {
  const db = openDb(":memory:");
  const runId = startRun(db, { devBaseUrl: "https://dev", prodBaseUrl: "https://prod", configJson: "{}", startedAt: "t" });
  saveComparison(db, runId, {
    path: "/", viewport: 1280, devUrl: "d", prodUrl: "p",
    devImage: new Uint8Array([1]), prodImage: new Uint8Array([2]), diffImage: new Uint8Array([3]),
    width: 1, height: 1, diffPixels: 0, diffScore: 0, passed: true, status: "ok",
  });
  finishRun(db, runId, "complete", "t2");
  const out = `${import.meta.dir}/.tmp-report-link.html`;
  try {
    await writeReport(db, runId, out, undefined, "link");
    const html = await Bun.file(out).text();
    expect(html).toContain('src=".tmp-report-link-images/0001-dev.png"');
    expect(html).not.toContain("data:image/png");
    expect(await Bun.file(`${import.meta.dir}/.tmp-report-link-images/0001-dev.png`).exists()).toBe(true);
  } finally {
    await Bun.file(out).delete().catch(() => {});
    rmSync(`${import.meta.dir}/.tmp-report-link-images`, { recursive: true, force: true });
  }
});

test("writeReport on a missing run throws", async () => {
  const db = openDb(":memory:");
  await expect(writeReport(db, 99, `${import.meta.dir}/.tmp-never.html`)).rejects.toThrow("run 99 not found");
});
