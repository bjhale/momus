// src/commands/init.ts

export function configScaffold(): string {
  return `import { defineConfig } from "momus";

export default defineConfig({
  dev: "https://dev.example.com",
  prod: "https://www.example.com",

  discovery: {
    sitemap: true,
    crawl: { enabled: true, startPath: "/", maxDepth: 3, maxPages: 500 },
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
});
`;
}

export async function runInit(cwd: string): Promise<string> {
  const path = `${cwd}/momus.config.ts`;
  if (await Bun.file(path).exists()) throw new Error(`${path} already exists`);
  await Bun.write(path, configScaffold());
  return path;
}
