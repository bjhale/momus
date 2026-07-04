// tests/capture/stabilize.test.ts
import { test, expect } from "bun:test";
import { disableAnimationsCss, maskCss } from "../../src/capture/stabilize";

test("disableAnimationsCss zeroes animation + transition", () => {
  const css = disableAnimationsCss();
  expect(css).toContain("animation");
  expect(css).toContain("transition");
  expect(css).toContain("0s");
});

test("maskCss hides each selector", () => {
  const css = maskCss([".ad", ".carousel"]);
  expect(css).toContain(".ad");
  expect(css).toContain(".carousel");
  expect(css).toContain("visibility: hidden");
});

test("maskCss with empty list is empty string", () => {
  expect(maskCss([])).toBe("");
});
