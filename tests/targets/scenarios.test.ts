// tests/targets/scenarios.test.ts
import { test, expect } from "bun:test";
import { ConfigSchema } from "../../src/config/schema";
import { scenariosSource } from "../../src/targets/scenarios";

const config = ConfigSchema.parse({
  dev: "https://dev.example.com", prod: "https://www.example.com",
  scenarios: [
    { id: "nav-open", path: "/", steps: [{ click: "button" }], capture: { element: "nav" }, viewports: [375] },
    { id: "signup", path: "/signup" },
  ],
});

test("scenarios become targets with prefixed ids, recipes and narrowed viewports", async () => {
  const [nav, signup] = await scenariosSource(config).listForSnapshot();
  expect(nav).toEqual({
    id: "scenarios:nav-open", source: "scenarios", label: "nav-open", path: "/",
    url: { dev: "https://dev.example.com/", prod: "https://www.example.com/" },
    recipe: { steps: [{ click: "button" }], capture: { element: "nav" } }, viewports: [375],
  });
  expect(signup!.recipe).toEqual({ steps: [] });
  expect("viewports" in signup!).toBe(false);
});

test("the live list is the config, independent of the baseline", async () => {
  const src = scenariosSource(config);
  expect(await src.listLive([])).toEqual(await src.listForSnapshot());
});
