// src/progress.ts
import { SingleBar } from "cli-progress";

/** Minimal progress seam so pipelines don't depend on the bar library directly. */
export interface Progress {
  /** Begin a phase with a known total and a human label. The instance is reusable. */
  start(total: number, label: string): void;
  /** Advance by one completed unit. */
  tick(): void;
  /** Finish the current phase. */
  stop(): void;
}

/** A cli-progress-backed Progress rendering to `stream` (stderr by default).
 * In a non-TTY (CI/pipe) it emits a plain line on a schedule (`noTTYOutput`),
 * not carriage-return redraws, so logs stay readable. */
export function makeProgress(stream: NodeJS.WritableStream = process.stderr): Progress {
  const bar = new SingleBar({
    format: "{label} [{bar}] {percentage}% | {value}/{total}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
    stream: stream as NodeJS.WriteStream,
    noTTYOutput: true,
    notTTYSchedule: 2000,
  });
  return {
    start(total, label) { bar.start(total, 0, { label }); },
    tick() { bar.increment(); },
    stop() { bar.stop(); },
  };
}
