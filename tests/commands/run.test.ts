// tests/commands/run.test.ts
import { test, expect } from "bun:test";
import { resultLine } from "../../src/commands/run";
import type { ComparisonRecord } from "../../src/types";

const row = (status: ComparisonRecord["status"]): ComparisonRecord =>
  ({ path: "/", viewport: 1, devUrl: "d", prodUrl: "p", status });

test("the result line is unchanged when nothing is unstable", () => {
  expect(resultLine("r.html", 3, [row("ok")], 0)).toBe("Wrote r.html for run #3 (1 comparisons). Exit 0.");
});

test("the result line names unstable targets, so CI logs show them", () => {
  expect(resultLine("r.html", 3, [row("ok"), row("unstable"), row("unstable")], 0))
    .toBe("Wrote r.html for run #3 (3 comparisons; 2 unstable, not gated). Exit 0.");
});
