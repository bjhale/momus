// src/commands/install.ts
// Downloads the pinned Chromium. Runs Playwright's installer in-process so a
// distributed binary needs no external `bunx`/npm. Exact entry point validated
// in the Chunk 0 spike (Task 0.4); adjust here if the pinned version differs.
export async function installBrowser(): Promise<number> {
  try {
    // playwright bundles a CLI "program" (commander) that registers the
    // `install` command on import. Invoking it in-process avoids relying on a
    // globally-installed `playwright` or `bunx`.
    // @ts-ignore — internal subpath; playwright/lib/program registers the CLI incl. `install`.
    const mod: any = await import("playwright/lib/program");
    const program = mod.program ?? mod.default;
    if (program && typeof program.parseAsync === "function") {
      // Note: commander's parseAsync may call process.exit() itself on
      // completion/error, in which case control never returns here — the exit
      // code is still correct. The explicit return covers the non-exiting path.
      await program.parseAsync(["node", "playwright", "install", "chromium"]);
      return 0;
    }
    throw new Error("playwright CLI program not found at expected path");
  } catch (err) {
    console.error(
      "Could not install Chromium in-process.\n" +
      "Install it once manually (use the same PLAYWRIGHT_BROWSERS_PATH momus uses, if set):\n" +
      "  npx playwright install chromium\n" +
      `Reason: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }
}
