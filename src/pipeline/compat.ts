// src/pipeline/compat.ts
import type { ResolvedConfig } from "../config/schema";
import { setupIdentity } from "../config/redact";
import type { SnapshotMeta } from "../store/db";
import type { StabilizeOptions } from "../capture/screenshot";
import type { Rendering } from "../capture/browser";

/** RFC-0006's capture settings, each with what a baseline that predates it was
 * captured with. Two of those aren't today's defaults, so a default config
 * refuses such a baseline with a hint rather than diff it against a different
 * capture (ADR-0032). `clock` reads as unset either way: JSON drops undefined,
 * so an old baseline and one captured without a clock look the same. */
const RFC_0006_STABILIZE: ReadonlyArray<readonly [keyof StabilizeOptions, unknown]> = [
  ["waitForImages", false],
  ["clock", null],
  ["reducedMotion", "no-preference"],
  ["colorScheme", "light"],
];

const shown = (v: unknown) => (v === null ? "unset" : JSON.stringify(v));

/** A prod baseline is only diff-able against dev when it was captured from the
 * same prod origin, and dev is captured with the same viewports and stabilize
 * settings. Returns a reason string on mismatch,
 * or null when the live config is compatible with the baseline. Compared
 * field-by-field so SQLite/JSON key ordering can never cause a false mismatch. */
export function baselineConflict(config: ResolvedConfig, snapshot: SnapshotMeta, rendering: Rendering = "host"): string | null {
  // A baseline from another site makes every diff meaningless while looking
  // clean. This also covers `run --prod`, which overrides config.prod
  // (ADR-0026). Origins, not full URLs: a trailing slash isn't another site.
  const co = origin(config.prod), so = origin(snapshot.prodBaseUrl);
  if (co !== so) {
    return `prod origin differs: config "${co}" vs baseline "${so}". ` +
      "Re-capture the baseline with `momus run --snapshot` (or `momus snapshot`), " +
      "or point output.db at a separate file for this site.";
  }

  if (config.browser !== (snapshot.browser ?? "chromium")) {
    return `browser differs: config "${config.browser}" vs baseline "${snapshot.browser ?? "chromium"}"`;
  }

  // One value for the environment, not its flags: tuning the pinned flags is
  // a momus change, not a reason to refuse every baseline (ADR-0033).
  const baseRendering = snapshot.rendering ?? "host";
  if (rendering !== baseRendering) {
    return `rendering differs: this run is "${rendering}" vs baseline "${baseRendering}". ` +
      "A baseline from the Docker image (pinned) only diffs against captures made in it, and the reverse. " +
      "Run where the baseline was captured, or re-capture it with `momus run --snapshot` (or `momus snapshot`).";
  }

  const cv = config.viewports, sv = snapshot.viewports;
  if (cv.length !== sv.length || cv.some((v, i) => v !== sv[i])) {
    return `viewports differ: config ${JSON.stringify(cv)} vs baseline ${JSON.stringify(sv)}`;
  }

  const cs = config.stabilize, ss = snapshot.stabilize;
  if (cs.waitUntil !== ss.waitUntil) {
    return `stabilize.waitUntil differs: config "${cs.waitUntil}" vs baseline "${ss.waitUntil}"`;
  }
  if (cs.settleMs !== ss.settleMs) {
    return `stabilize.settleMs differs: config ${cs.settleMs} vs baseline ${ss.settleMs}`;
  }
  if (cs.timeoutMs !== ss.timeoutMs) {
    return `stabilize.timeoutMs differs: config ${cs.timeoutMs} vs baseline ${ss.timeoutMs}`;
  }
  if (cs.disableAnimations !== ss.disableAnimations) {
    return `stabilize.disableAnimations differs: config ${cs.disableAnimations} vs baseline ${ss.disableAnimations}`;
  }
  if (cs.mask.length !== ss.mask.length || cs.mask.some((m, i) => m !== ss.mask[i])) {
    return `stabilize.mask differs: config ${JSON.stringify(cs.mask)} vs baseline ${JSON.stringify(ss.mask)}`;
  }
  const cr = cs.remove ?? [], sr = ss.remove ?? [];
  if (cr.length !== sr.length || cr.some((m, i) => m !== sr[i])) {
    return `stabilize.remove differs: config ${JSON.stringify(cr)} vs baseline ${JSON.stringify(sr)}`;
  }

  for (const [key, before] of RFC_0006_STABILIZE) {
    const live = cs[key] ?? null;
    const stored = ss[key] ?? before;
    if (live !== stored) {
      const predates = ss[key] === undefined && before !== null;
      return `stabilize.${key} differs: config ${shown(live)} vs baseline ${shown(stored)}` +
        (predates ? " (the baseline predates this setting; re-capture it with `momus run --snapshot` or `momus snapshot`)" : "");
    }
  }

  // Only prod's setup shaped the baseline, so dev's may change freely. Fill
  // values and storageState aren't part of it (RFC-0004, ADR-0030).
  if (setupIdentity(config) !== (snapshot.setupJson ?? null)) {
    return "prod setup differs from the baseline's (fill values and storageState files are not compared). " +
      "Re-capture the baseline with `momus run --snapshot` (or `momus snapshot`).";
  }

  return null;
}

function origin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}
