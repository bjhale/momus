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
  browser: "chromium",   // "chromium" | "firefox" | "webkit"
  // insecure: false,   // set true to ignore invalid/self-signed TLS certs (dev only)

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
    // remove: [".cookie-banner"],   // delete elements from the DOM before capture (space collapses)
  },

  // Pages in another state. Steps: click, hover, fill, press, select, scroll, waitFor, wait, evaluate.
  // Don't put credentials in scenario steps; they are stored in the .sqlite as-is.
  // scenarios: [
  //   {
  //     id: "nav-open",
  //     path: "/",
  //     steps: [{ click: "button[aria-label=Menu]" }, { waitFor: "nav[data-open]" }],
  //     capture: { element: "nav" },   // optional; default is the full page
  //     viewports: [375],              // optional; narrows the viewports above
  //   },
  // ],

  // Log in once per side before capturing. Credentials belong here (or in a
  // storageState file), read from the environment, never in scenarios.
  // setup: {
  //   dev: {
  //     steps: [
  //       { goto: "/login" },
  //       { fill: ["#email", Bun.env.MOMUS_DEV_USER] },
  //       { fill: ["#password", Bun.env.MOMUS_DEV_PASS] },
  //       { click: "button[type=submit]" },
  //       { waitFor: "[data-user-menu]" },
  //     ],
  //   },
  //   prod: { storageState: "prod-auth.json" },   // or steps, chosen per side
  // },

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
