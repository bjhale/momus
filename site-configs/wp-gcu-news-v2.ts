export default {
  dev: "https://news.gce-labs.com/",
  prod: "https://news.gcu.edu/",
  browser: "chromium", // "chromium" | "firefox" | "webkit"
  // insecure: false,   // set true to ignore invalid/self-signed TLS certs (dev only)

  requestHeaders: {
    ...(Bun.env.CF_ACCESS_CLIENT_ID && {
      "CF-Access-Client-Id": Bun.env.CF_ACCESS_CLIENT_ID,
    }),
    ...(Bun.env.CF_ACCESS_CLIENT_SECRET && {
      "CF-Access-Client-Secret": Bun.env.CF_ACCESS_CLIENT_SECRET,
    }),
  },

  discovery: {
    // urlList: "urls.txt",   // optional: newline-delimited full URLs or paths
    sitemap: true,
    maxPages: 5,
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

  diff: {
    threshold: 0.1,
    failScore: 0.01,
    overrides: [{ path: "/blog/**", failScore: 0.05 }],
  },

  concurrency: { screenshots: 6, diffWorkers: 4 },

  output: { report: "momus-report.html", db: "momus.sqlite" },
};
