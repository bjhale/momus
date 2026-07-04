// build.ts
// Compiles momus to a single binary. Playwright browser remains external
// (installed via `momus install-browser`), per spec §1/§7.
//
// `chromium-bidi` MUST be external (confirmed by the Chunk 0 spike): Playwright's
// playwright-core has dynamic require()s for the WebDriver-BiDi transport that
// Bun's bundler cannot resolve statically, so the compile fails without this.
// We drive Chromium over CDP (the default), so the BiDi path is never taken at
// runtime and externalizing it is safe.
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: { outfile: "momus" },
  target: "bun",
  external: ["chromium-bidi"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("Built ./momus");

// Make this a module so top-level `await` (above) type-checks under the
// project tsconfig, which includes build.ts. No runtime effect.
export {};
