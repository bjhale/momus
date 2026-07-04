// src/commands/install.ts
// Downloads the Chromium that momus drives, via Playwright's own installer.
// This is for running momus from source — the Docker image already includes
// Chromium and its dependencies, so it never needs this command.
export async function installBrowser(): Promise<number> {
  try {
    // playwright bundles a CLI "program" (commander) that registers the
    // `install` command on import.
    // @ts-ignore — internal subpath; playwright/lib/program registers `install`.
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
        "momus could not download Chromium.",
        "Install it with Playwright's installer, then re-run momus:",
        "",
        "  npx playwright install chromium",
        "",
        "or point momus at an existing browser cache:",
        "",
        "  export PLAYWRIGHT_BROWSERS_PATH=/path/to/ms-playwright",
        "",
        "Or use the momus Docker image, which already includes Chromium.",
      ].join("\n"),
    );
    return 2;
  }
}
