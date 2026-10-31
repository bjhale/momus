// src/commands/capture-seams.ts
import type { Browser } from "playwright-core";
import type { ResolvedConfig } from "../config/schema";
import type { StorageState } from "../capture/browser";
import { capture } from "../capture/screenshot";
import { runSetup, type Side } from "../capture/setup";
import type { Job } from "../pipeline/run";
import type { Recipe } from "../targets/target";

/** The real setup and capture functions both commands hand the pipelines.
 * Sessions are filled by the setup seams and read by the captures, so a side's
 * login happens once however many targets it captures. */
export function captureSeams(browser: Browser, config: ResolvedConfig) {
  const sessions: Partial<Record<Side, StorageState>> = {};
  return {
    setupDev: async () => { sessions.dev = await runSetup(browser, "dev", config); },
    setupProd: async () => { sessions.prod = await runSetup(browser, "prod", config); },
    captureProd: (url: string, viewport: number, cfg: ResolvedConfig, recipe?: Recipe) =>
      capture(browser, url, viewport, cfg.stabilize, cfg.insecure, cfg.requestHeaders, { recipe, storageState: sessions.prod }),
    getDev: (job: Job) =>
      capture(browser, job.devUrl, job.viewport, config.stabilize, config.insecure, config.requestHeaders,
        { recipe: job.recipe, storageState: sessions.dev }),
  };
}
