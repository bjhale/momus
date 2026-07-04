// src/pipeline/compat.ts
import type { ResolvedConfig } from "../config/schema";
import type { SnapshotMeta } from "../store/db";

/** A prod baseline is only diff-able against dev when dev is captured with the
 * same viewports and stabilize settings. Returns a reason string on mismatch,
 * or null when the live config is compatible with the baseline. Compared
 * field-by-field so SQLite/JSON key ordering can never cause a false mismatch. */
export function baselineConflict(config: ResolvedConfig, snapshot: SnapshotMeta): string | null {
  const cv = config.viewports, sv = snapshot.viewports;
  if (cv.length !== sv.length || cv.some((v, i) => v !== sv[i])) {
    return `viewports differ: config ${JSON.stringify(cv)} vs baseline ${JSON.stringify(sv)}`;
  }

  const cs = config.stabilize, ss = snapshot.stabilize;
  if (
    cs.waitUntil !== ss.waitUntil ||
    cs.settleMs !== ss.settleMs ||
    cs.timeoutMs !== ss.timeoutMs ||
    cs.disableAnimations !== ss.disableAnimations ||
    cs.mask.length !== ss.mask.length ||
    cs.mask.some((m, i) => m !== ss.mask[i])
  ) {
    return `stabilize settings differ from the baseline; re-snapshot or align momus.config.ts`;
  }

  return null;
}
