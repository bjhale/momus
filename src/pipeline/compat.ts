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

  return null;
}
