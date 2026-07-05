// src/commands/init.ts

export function configScaffold(): string {
  // A plain object (not `defineConfig` from "momus") so the config resolves with
  // no dependency on the momus package being importable — it runs as-is inside
  // the Docker image and anywhere else. The config is validated at runtime (Zod);
  // every field has a sensible default. If you install momus as a dependency you
  // can wrap this in `defineConfig(...)` (imported from "momus") for editor types.
  return `export default {
  dev: "https://dev.example.com",
  prod: "https://www.example.com",

  discovery: {
    // urlList: "urls.txt",   // optional: newline-delimited full URLs or paths
    sitemap: true,
    maxPages: 500,
    crawl: false,
    include: ["/**"],
    exclude: ["/admin/**"],
  },

  viewports: [375, 768, 1280],

  stabilize: {
    waitUntil: "networkidle",
    settleMs: 500,
    timeoutMs: 15000,
    disableAnimations: true,
    mask: [".carousel", ".ad-slot", "[data-timestamp]"],
  },

  diff: {
    threshold: 0.1,
    failScore: 0.01,
    overrides: [{ path: "/blog/**", failScore: 0.05 }],
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite" },
};
`;
}

export async function runInit(cwd: string): Promise<string> {
  const path = `${cwd}/momus.config.ts`;
  if (await Bun.file(path).exists()) throw new Error(`${path} already exists`);
  await Bun.write(path, configScaffold());
  return path;
}
