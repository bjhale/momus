// tests/targets/reconcile.test.ts
import { test, expect } from "bun:test";
import { reconcile } from "../../src/targets/reconcile";
import type { Target, TargetSourceName } from "../../src/targets/target";
import type { BaselineImageRow } from "../../src/store/db";

function row(targetId: string, viewport: number, source: TargetSourceName = "pages", recipeJson: string | null = null): BaselineImageRow {
  const path = source === "pages" ? targetId : "/";
  return { targetId, source, label: targetId, path, viewport, prodUrl: `https://prod${path}`, recipeJson, status: "ok" };
}
function target(id: string, source: TargetSourceName = "pages", extra: Partial<Target> = {}): Target {
  const path = source === "pages" ? id : "/";
  return { id, source, label: id, path, url: { dev: `https://dev${path}`, prod: `https://prod${path}` }, ...extra };
}
const run = (baseline: BaselineImageRow[], live: [TargetSourceName, Target[]][], failed: [TargetSourceName, string][] = [], viewports = [1280]) =>
  reconcile({ baseline, live: new Map(live), failed: new Map(failed), viewports });

test("present on both sides: compare, dev URL from live, prod URL from baseline", () => {
  const jobs = run([row("/a", 1280)], [["pages", [target("/a")]]]);
  expect(jobs).toEqual([{ targetId: "/a", source: "pages", label: "/a", path: "/a", viewport: 1280,
    devUrl: "https://dev/a", prodUrl: "https://prod/a", action: "compare" }]);
});

test("live without baseline: added", () => {
  const jobs = run([], [["pages", [target("/new")]]]);
  expect(jobs.map((j) => [j.targetId, j.action])).toEqual([["/new", "added"]]);
});

test("baseline without live (source listed fine): removed, keeps the baseline prod URL", () => {
  const jobs = run([row("scenarios:gone", 1280, "scenarios")], [["scenarios", []]]);
  expect(jobs.map((j) => [j.targetId, j.action, j.prodUrl])).toEqual([["scenarios:gone", "removed", "https://prod/"]]);
});

test("baseline row of a source not configured at all: removed", () => {
  const jobs = run([row("scenarios:x", 1280, "scenarios")], [["pages", []]]);
  expect(jobs.map((j) => j.action)).toEqual(["removed"]);
});

test("failed source: its rows are skipped, one viewport-less error job, others unaffected", () => {
  const jobs = run(
    [row("/a", 1280), row("scenarios:x", 1280, "scenarios")],
    [["pages", [target("/a")]]],
    [["scenarios", "ECONNREFUSED"]],
  );
  expect(jobs.map((j) => [j.targetId, j.action, j.viewport])).toEqual([
    ["/a", "compare", 1280],
    ["source:scenarios", "error", 0],
  ]);
  expect(jobs[1]!.error).toBe("could not list scenarios targets: ECONNREFUSED");
  expect(jobs[1]!.label).toBe("scenarios source");
});

test("recipe changed: error for that target only", () => {
  const jobs = run(
    [row("scenarios:a", 1280, "scenarios", '{"steps":1}'), row("scenarios:b", 1280, "scenarios", null)],
    [["scenarios", [target("scenarios:a", "scenarios", { recipe: { steps: 2 } }), target("scenarios:b", "scenarios")]]],
  );
  expect(jobs.map((j) => [j.targetId, j.action])).toEqual([["scenarios:a", "error"], ["scenarios:b", "compare"]]);
  expect(jobs[0]!.error).toContain("recipe changed");
});

test("same recipe with different key order still compares", () => {
  const jobs = run(
    [row("scenarios:a", 1280, "scenarios", '{"a":1,"b":2}')],
    [["scenarios", [target("scenarios:a", "scenarios", { recipe: { b: 2, a: 1 } })]]],
  );
  expect(jobs[0]!.action).toBe("compare");
});

test("per-target viewport narrowing: a dropped width is removed, a new one added", () => {
  const jobs = run(
    [row("scenarios:a", 375, "scenarios")],
    [["scenarios", [target("scenarios:a", "scenarios", { viewports: [1280] })]]],
    [], [375, 1280],
  );
  expect(jobs.map((j) => [j.viewport, j.action])).toEqual([[375, "removed"], [1280, "added"]]);
});
