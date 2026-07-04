// src/commands/install.ts
// Obtains the Chromium that momus drives.
//
// When running from source (node_modules present) momus can invoke Playwright's
// own installer in-process. In the STANDALONE binary that isn't possible —
// Playwright's installer resolves its package files from node_modules, which a
// compiled binary doesn't carry — so momus prints clear guidance instead of a
// cryptic error. Either way, momus at run time finds Chromium via
// $PLAYWRIGHT_BROWSERS_PATH or the default Playwright cache.
export async function installBrowser(): Promise<number> {
  try {
    // playwright bundles a CLI "program" (commander) that registers the
    // `install` command on import. This path works from source.
    // @ts-ignore — internal subpath; playwright/lib/program registers the CLI incl. `install`.
    const mod: any = await import("playwright/lib/program");
    const program = mod.program ?? mod.default;
    if (program && typeof program.parseAsync === "function") {
      // Note: commander's parseAsync may call process.exit() itself, in which
      // case control never returns here — the exit code is still correct.
      await program.parseAsync(["node", "playwright", "install", "chromium"]);
      return 0;
    }
    throw new Error("installer entry point not found");
  } catch {
    console.error(
      [
        "momus can't download Chromium from the standalone binary.",
        "Install it once with either of these, then re-run momus:",
        "",
        "  • Playwright's installer (needs Node/npm available):",
        "      npx playwright install chromium",
        "",
        "  • Or point momus at an existing browser install:",
        "      export PLAYWRIGHT_BROWSERS_PATH=/path/to/ms-playwright",
        "",
        "Or skip this entirely and use the momus Docker image, which already",
        "includes Chromium and its dependencies.",
      ].join("\n"),
    );
    return 2;
  }
}
