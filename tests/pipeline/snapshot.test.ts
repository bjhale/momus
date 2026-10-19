// tests/pipeline/snapshot.test.ts
import { test, expect } from "bun:test";
import { PNG } from "pngjs";
import { snapshotPipeline, ProdUnreachableError } from "../../src/pipeline/snapshot";
import { openDb, readSnapshot, readBaselineImages, startRun, listRunIds } from "../../src/store/db";
import { ConfigSchema } from "../../src/config/schema";
import type { Target, TargetSource } from "../../src/targets/target";

function png(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 }); p.data.fill(v);
  return new Uint8Array(PNG.sync.write(p));
}

test("snapshotPipeline captures prod and writes baseline tables", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "2026-07-04T00:00:00Z",
    discover: async () => ["/", "/pricing"],
    captureFn: async () => ({ ok: true, png: png(100) }),
  });

  const rows = readBaselineImages(db);
  expect(rows.length).toBe(4); // 2 paths × 2 viewports
  for (const r of rows) { expect(r.status).toBe("ok"); expect(r.image).toBeInstanceOf(Uint8Array); }

  const snap = readSnapshot(db)!;
  expect(snap.prodBaseUrl).toBe("https://www.example.com");
  expect(snap.viewports).toEqual([375, 1280]);
  expect(rows.some((r) => r.prodUrl === "https://www.example.com/pricing")).toBe(true);
});

test("a failed prod capture is stored as an error row, snapshot still written", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/broken"],
    captureFn: async (url) => url.includes("/broken") ? { ok: false, error: "404" } : { ok: true, png: png(100) },
  });

  const rows = readBaselineImages(db);
  const broken = rows.find((r) => r.path === "/broken")!;
  expect(broken.status).toBe("error");
  expect(broken.error).toContain("404");
  expect(broken.image).toBeUndefined();
  expect(readSnapshot(db)).not.toBeNull();
});

test("discovery failure leaves any prior baseline intact and propagates", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");

  // Seed a prior baseline.
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  expect(readBaselineImages(db).length).toBe(1);

  // A re-snapshot whose discovery throws must NOT wipe the existing baseline.
  await expect(snapshotPipeline({
    config, db, createdAt: "t2",
    discover: async () => { throw new Error("no pages discovered"); },
    captureFn: async () => ({ ok: true, png: png(50) }),
  })).rejects.toThrow("no pages discovered");

  expect(readBaselineImages(db).length).toBe(1); // old baseline preserved
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

import type { Progress } from "../../src/progress";

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("snapshotPipeline reports progress: start('Capturing prod', total), tick per job, stop", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/pricing"], // 2 jobs
    captureFn: async () => ({ ok: true, png: png(100) }),
    progress: p,
  });

  expect(rec.starts).toEqual([{ total: 2, label: "Capturing prod" }]);
  expect(rec.ticks).toBe(2);
  expect(rec.stops).toBe(1);
});

function fakeSource(targets: Target[] | (() => Promise<Target[]>)): TargetSource {
  const list = typeof targets === "function" ? targets : async () => targets;
  return { name: "scenarios", listForSnapshot: list, listLive: list };
}
const scenario = (id: string, extra: Partial<Target> = {}): Target => ({
  id, source: "scenarios", label: `Label ${id}`, path: "/",
  url: { dev: "https://dev.example.com/", prod: "https://www.example.com/" }, ...extra,
});

test("extra sources are captured with identity, recipe and per-target viewports", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/"],
    sources: [fakeSource([scenario("scenarios:nav", { recipe: { b: 1, a: 2 }, viewports: [375] })])],
    captureFn: async () => ({ ok: true, png: png(100) }),
  });
  const rows = readBaselineImages(db);
  expect(rows.map((r) => [r.targetId, r.viewport])).toEqual([["/", 375], ["/", 1280], ["scenarios:nav", 375]]);
  const sc = rows.find((r) => r.targetId === "scenarios:nav")!;
  expect([sc.source, sc.label, sc.recipeJson]).toEqual(["scenarios", "Label scenarios:nav", '{"a":2,"b":1}']);
  expect(rows.find((r) => r.targetId === "/")!.recipeJson).toBeNull();
});

test("a bad target id fails the snapshot before the old baseline is cleared", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(100) }) });
  await expect(snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/"],
    sources: [fakeSource([scenario("nav")])], // missing the "scenarios:" prefix
    captureFn: async () => ({ ok: true, png: png(100) }),
  })).rejects.toThrow('must start with "scenarios:"');
  expect(readSnapshot(db)!.createdAt).toBe("t1");
  expect(readBaselineImages(db).length).toBe(1);
});

test("a source that fails to list fails the snapshot and keeps the old baseline", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(100) }) });
  await expect(snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/"],
    sources: [fakeSource(async () => { throw new Error("index.json unreachable"); })],
    captureFn: async () => ({ ok: true, png: png(100) }),
  })).rejects.toThrow("index.json unreachable");
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

test("a snapshot leaves run history alone", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const id = startRun(db, { devBaseUrl: "d", prodBaseUrl: "p", configJson: "{}", startedAt: "s" });
  await snapshotPipeline({ config, db, createdAt: "t", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(1) }) });
  expect(listRunIds(db)).toEqual([id]);
});

test("every capture failing saves nothing and throws ProdUnreachableError", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");
  const run = snapshotPipeline({
    config, db, createdAt: "t", discover: async () => ["/", "/a"],
    captureFn: async () => ({ ok: false, error: "net::ERR_CONNECTION_REFUSED" }),
  });
  await expect(run).rejects.toBeInstanceOf(ProdUnreachableError);
  await expect(run).rejects.toThrow(/unreachable.*4 of 4.*ERR_CONNECTION_REFUSED/s);
  expect(readSnapshot(db)).toBeNull();
  expect(readBaselineImages(db).length).toBe(0);
});

test("an all-error re-snapshot keeps the previous baseline byte for byte", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  const before = readSnapshot(db)!;
  await expect(snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/", "/new"],
    captureFn: async () => ({ ok: false, error: "timeout" }),
  })).rejects.toBeInstanceOf(ProdUnreachableError);
  expect(readSnapshot(db)).toEqual(before);
  const rows = readBaselineImages(db);
  expect(rows.map((r) => r.path)).toEqual(["/"]);
  expect(Array.from(rows[0]!.image!)).toEqual(Array.from(png(50)));
});

test("a re-snapshot where some captures fail replaces the baseline, error rows included", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/", "/old-only"], captureFn: async () => ({ ok: true, png: png(50) }) });
  await snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/", "/new"],
    captureFn: async (url) => url.endsWith("/new") ? { ok: false, error: "timeout" } : { ok: true, png: png(90) },
  });
  expect(readSnapshot(db)!.createdAt).toBe("t2");
  const rows = readBaselineImages(db);
  expect(rows.map((r) => [r.path, r.status]).sort()).toEqual([["/", "ok"], ["/new", "error"]]);
  expect(rows.some((r) => r.path === "/old-only")).toBe(false);
  expect(Array.from(rows.find((r) => r.path === "/")!.image!)).toEqual(Array.from(png(90)));
});

test("a capture function that throws rolls the baseline back too", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  await expect(snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/"],
    captureFn: async () => { throw new Error("browser crashed"); },
  })).rejects.toThrow("browser crashed");
  expect(readSnapshot(db)!.createdAt).toBe("t1");
  // The connection is usable afterwards: no transaction left open.
  expect(() => db.exec("BEGIN; COMMIT;")).not.toThrow();
});

test("a throwing capture with siblings still in flight leaves the previous baseline intact", async () => {
  const config = ConfigSchema.parse({
    dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280],
    concurrency: { screenshots: 4 },
  });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"], captureFn: async () => ({ ok: true, png: png(50) }) });
  const before = readSnapshot(db)!;
  let stops = 0;
  await expect(snapshotPipeline({
    config, db, createdAt: "t2", discover: async () => ["/a", "/b", "/c", "/d"],
    captureFn: async (url) => {
      if (url.endsWith("/a")) throw new Error("boom");
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, png: png(99) };
    },
    progress: { start: () => {}, tick: () => {}, stop: () => { stops++; } },
  })).rejects.toThrow("boom");
  await new Promise((r) => setTimeout(r, 80)); // let any straggler write
  expect(stops).toBe(1);
  expect(readSnapshot(db)).toEqual(before);
  const rows = readBaselineImages(db);
  expect(rows.map((r) => r.path)).toEqual(["/"]);
  expect(Array.from(rows[0]!.image!)).toEqual(Array.from(png(50)));
});

test("captureFn receives each target's recipe; pages get none", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const seen: Array<[string, unknown]> = [];
  await snapshotPipeline({
    config, db, createdAt: "t", discover: async () => ["/"],
    sources: [fakeSource([scenario("scenarios:nav", { recipe: { steps: [{ click: "b" }] } })])],
    captureFn: async (url, _vw, _cfg, recipe) => { seen.push([url, recipe]); return { ok: true, png: png(1) }; },
  });
  expect(seen).toContainEqual(["https://www.example.com/", undefined]);
  expect(seen).toContainEqual(["https://www.example.com/", { steps: [{ click: "b" }] }]);
});

test("setup runs after listing and before any capture", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const order: string[] = [];
  await snapshotPipeline({ config, db, createdAt: "t",
    discover: async () => { order.push("discover"); return ["/"]; },
    setup: async () => { order.push("setup"); },
    captureFn: async () => { order.push("capture"); return { ok: true, png: png(1) }; } });
  expect(order).toEqual(["discover", "setup", "capture"]);
});

test("a setup failure rejects, captures nothing, and keeps the previous baseline", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  await snapshotPipeline({ config, db, createdAt: "t1", discover: async () => ["/"],
    captureFn: async () => ({ ok: true, png: png(1) }) });
  let captured = false;
  await expect(snapshotPipeline({ config, db, createdAt: "t2", discover: async () => ["/"],
    setup: async () => { throw new Error("setup (prod) step 1: goto \"/login\": HTTP 500"); },
    captureFn: async () => { captured = true; return { ok: true, png: png(2) }; } })).rejects.toThrow("setup (prod)");
  expect(captured).toBe(false);
  expect(readSnapshot(db)!.createdAt).toBe("t1");
});

// --- RFC-0006: stabilize.verify ---

/** Opaque gray: png(v) also sets alpha to v, so two of those can blend alike. */
function opaque(v: number): Uint8Array {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 16; i++) p.data.set([v, v, v, 255], i * 4);
  return new Uint8Array(PNG.sync.write(p));
}

const verifyCfg = (verify: boolean) =>
  ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280], stabilize: { verify } });

test("verify: a target that renders differently twice is stored unstable, keeping the first capture", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  await snapshotPipeline({
    config: verifyCfg(true), db, createdAt: "t",
    discover: async () => ["/"],
    captureFn: async () => ({ ok: true, png: opaque(++calls === 1 ? 0 : 255) }),
  });
  expect(calls).toBe(2);
  const [row] = readBaselineImages(db);
  expect(row!.status).toBe("ok");
  expect(Array.from(row!.image!)).toEqual(Array.from(opaque(0)));
  expect(row!.unstableRegions).toEqual([{ x: 0, y: 0, width: 4, height: 4 }]);
});

test("verify: identical captures are not unstable", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  await snapshotPipeline({
    config: verifyCfg(true), db, createdAt: "t",
    discover: async () => ["/", "/a"],
    captureFn: async () => { calls++; return { ok: true, png: png(100) }; },
  });
  expect(calls).toBe(4);
  for (const r of readBaselineImages(db)) expect(r.unstableRegions).toBeUndefined();
});

test("verify off: one capture per target", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  await snapshotPipeline({
    config: verifyCfg(false), db, createdAt: "t",
    discover: async () => ["/", "/a"],
    captureFn: async (_u, _v, _c) => ({ ok: true, png: png(++calls) }),
  });
  expect(calls).toBe(2);
});

test("verify: a failing second capture keeps the first, unmarked", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  await snapshotPipeline({
    config: verifyCfg(true), db, createdAt: "t",
    discover: async () => ["/"],
    captureFn: async () => (++calls === 1 ? { ok: true, png: png(100) } : { ok: false, error: "timeout" }),
  });
  const [row] = readBaselineImages(db);
  expect(row!.status).toBe("ok");
  expect(row!.unstableRegions).toBeUndefined();
});

test("verify uses the diff pool when one is given", async () => {
  const db = openDb(":memory:");
  const seen: number[] = [];
  await snapshotPipeline({
    config: verifyCfg(true), db, createdAt: "t",
    discover: async () => ["/"],
    captureFn: async () => ({ ok: true, png: png(100) }),
    diffPool: {
      submit: async (a, _b, opts) => {
        seen.push(opts.threshold);
        return { id: 1, ok: true, width: 4, height: 4, diffPixels: 3, diffScore: 0.2, diffPng: a,
          regions: [{ x: 1, y: 1, width: 2, height: 2 }], regionCount: 1 };
      },
      close: async () => {},
    },
  });
  expect(seen).toEqual([0.1]);
  expect(readBaselineImages(db)[0]!.unstableRegions).toEqual([{ x: 1, y: 1, width: 2, height: 2 }]);
});

test("verify: a second capture that throws keeps the first, and the snapshot commits", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  await snapshotPipeline({
    config: verifyCfg(true), db, createdAt: "t",
    discover: async () => ["/"],
    captureFn: async () => {
      if (++calls === 2) throw new Error("Target page, context or browser has been closed");
      return { ok: true, png: png(100) };
    },
  });
  const [row] = readBaselineImages(db);
  expect(row!.status).toBe("ok");
  expect(row!.unstableRegions).toBeUndefined();
  expect(readSnapshot(db)).not.toBeNull();
});
