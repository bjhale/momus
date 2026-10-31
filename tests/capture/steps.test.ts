// tests/capture/steps.test.ts
import { test, expect } from "bun:test";
import { describeStep, StepError } from "../../src/capture/steps";

test("describeStep names the verb and selector", () => {
  expect(describeStep({ click: "button[aria-label=Menu]" })).toBe('click "button[aria-label=Menu]"');
  expect(describeStep({ waitFor: { hidden: ".spinner" } })).toBe('waitFor hidden ".spinner"');
  expect(describeStep({ press: "Escape" })).toBe('press "Escape"');
  expect(describeStep({ press: ["#q", "Enter"] })).toBe('press "Enter" on "#q"');
  expect(describeStep({ wait: 200 })).toBe("wait 200ms");
  expect(describeStep({ goto: "/login" })).toBe('goto "/login"');
  expect(describeStep({ evaluate: "window.secret = 1" })).toBe("evaluate");
});

test("describeStep never includes a typed value, which may be a secret", () => {
  expect(describeStep({ fill: ["#password", "hunter2"] })).toBe('fill "#password"');
  expect(describeStep({ select: ["#plan", "enterprise"] })).toBe('select "#plan"');
});

test("StepError is 1-based and names the step", () => {
  const e = new StepError(3, 'fill "#password"', "Timeout 100ms exceeded.");
  expect(e.message).toBe('step 3: fill "#password": Timeout 100ms exceeded.');
  expect([e.index, e.step]).toEqual([3, 'fill "#password"']);
});
