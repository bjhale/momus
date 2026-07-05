# Progress Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live per-phase progress bars (prod capture; dev capture + diff) during `momus run`/`snapshot`, backed by `cli-progress`, rendered to stderr with periodic plain lines in non-TTY.

**Architecture:** A tiny `Progress` interface (`start`/`tick`/`stop`) decouples the pipelines from the library. `makeProgress()` wraps a `cli-progress` `SingleBar`. `runPipeline` and `snapshotPipeline` take an optional `progress` and drive it; `runFlow` forwards it so a first (materializing) run shows two sequential bars. Both commands create the bar and pass it in.

**Tech Stack:** Bun, TypeScript, `cli-progress`, `bun:test`.

## Global Constraints

- Runtime is **Bun**; tests use `bun:test`.
- `Progress` interface: `start(total: number, label: string): void`, `tick(): void`, `stop(): void`.
- `makeProgress(stream = process.stderr)` wraps `cli-progress` `SingleBar`, format `"{label} [{bar}] {percentage}% | {value}/{total}"`, `noTTYOutput: true`, `notTTYSchedule: 2000`, rendering to **stderr** (keeps stdout clean).
- Labels: `snapshotPipeline` → `"Capturing prod"`; `runPipeline` → `"Capturing dev + diffing"`.
- Pipelines take `progress?: Progress`; `undefined` = today's behavior (no bar). `tick()` fires once per job in a `finally` (so error jobs still advance). `start()` after the jobs list is known; `stop()` only on the normal-completion path (not in the catch/throw path).
- Both new deps: `cli-progress` (runtime) + `@types/cli-progress` (dev).
- No `--no-progress` flag, no config field (out of scope).
- Commit after each task.

---

## File Structure

- `src/progress.ts` — **create**: `Progress` interface + `makeProgress`.
- `src/pipeline/run.ts` — **modify**: `RunPipelineArgs.progress?`; drive it in `runPipeline`.
- `src/pipeline/snapshot.ts` — **modify**: `SnapshotPipelineArgs.progress?`; drive it in `snapshotPipeline`.
- `src/pipeline/run-flow.ts` — **modify**: `RunFlowArgs.progress?`; forward to both pipelines.
- `src/commands/run.ts`, `src/commands/snapshot.ts` — **modify**: `makeProgress()` and pass it in.
- `package.json` — **modify**: add deps.
- `README.md` — **modify**: brief progress note.
- Tests: `tests/progress.test.ts` (new), `tests/pipeline/run.test.ts`, `tests/pipeline/snapshot.test.ts`, `tests/pipeline/run-flow.test.ts`.

---

## Task 1: `Progress` interface + `makeProgress` + dependency

**Files:**
- Modify: `package.json` (via `bun add`)
- Create: `src/progress.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Produces:
  - `interface Progress { start(total: number, label: string): void; tick(): void; stop(): void }`
  - `makeProgress(stream?: NodeJS.WritableStream): Progress`

- [ ] **Step 1: Add the dependency**

Run:
```bash
bun add cli-progress
bun add -d @types/cli-progress
```
Expected: `package.json` gains `cli-progress` under `dependencies` and `@types/cli-progress` under `devDependencies`; `bun.lock` updates; install succeeds.

- [ ] **Step 2: Write the failing test**

Create `tests/progress.test.ts`:

```typescript
// tests/progress.test.ts
import { test, expect } from "bun:test";
import { makeProgress } from "../src/progress";

// A synchronous fake stream so cli-progress writes are captured without stream
// event-loop timing. `isTTY: false` puts cli-progress in its dumb-terminal path.
function captureStream() {
  let data = "";
  const stream = {
    write: (chunk: unknown) => { data += String(chunk); return true; },
    isTTY: false,
  } as unknown as NodeJS.WritableStream;
  return { stream, get: () => data };
}

test("makeProgress returns a Progress with callable start/tick/stop", () => {
  const p = makeProgress(captureStream().stream);
  expect(typeof p.start).toBe("function");
  expect(typeof p.tick).toBe("function");
  expect(typeof p.stop).toBe("function");
});

test("driving the bar does not throw and writes to the given stream", () => {
  const cap = captureStream();
  const p = makeProgress(cap.stream);
  p.start(2, "TestPhase");
  p.tick();
  p.stop();
  expect(cap.get().length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test tests/progress.test.ts`
Expected: FAIL — `makeProgress` is not defined.

- [ ] **Step 4: Implement `src/progress.ts`**

```typescript
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/progress.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

Notes:
- If the named import `{ SingleBar }` fails to resolve under Bun, use `import cliProgress from "cli-progress";` and `new cliProgress.SingleBar({...})`.
- If the second test's `cap.get().length` is `0` (cli-progress renders only on its 2s timer in this environment, never synchronously on `start`/`stop`), delete that single assertion — the first test (shape/no-throw) is the wrapper's contract; keep the `p.start/tick/stop` calls in the second test so the delegation path is still exercised without throwing.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/progress.ts tests/progress.test.ts
git commit -m "feat: add Progress seam + cli-progress-backed makeProgress"
```

---

## Task 2: Drive progress from both pipelines

**Files:**
- Modify: `src/pipeline/run.ts`, `src/pipeline/snapshot.ts`
- Test: `tests/pipeline/run.test.ts`, `tests/pipeline/snapshot.test.ts`

**Interfaces:**
- Consumes: `Progress` (Task 1).
- Produces: `RunPipelineArgs.progress?: Progress` and `SnapshotPipelineArgs.progress?: Progress`, each driven `start(total, label) → tick() per job → stop()`.

- [ ] **Step 1: Write the failing pipeline tests**

Append to `tests/pipeline/run.test.ts`:

```typescript
import type { Progress } from "../../src/progress";

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("runPipeline reports progress: start(total), tick per job, stop", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [375, 1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/", "/x"], [375, 1280]), // 4 jobs
    getDev: okPng, getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
    progress: p,
  });

  expect(rec.starts).toEqual([{ total: 4, label: "Capturing dev + diffing" }]);
  expect(rec.ticks).toBe(4);
  expect(rec.stops).toBe(1);
});

test("runPipeline ticks even for error jobs", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runPipeline({
    config, db, startedAt: "s", finishedAt: "f",
    listJobs: async () => jobs(["/ok", "/boom"], [1280]),
    getDev: async (job) => { if (job.path === "/boom") throw new Error("x"); return { ok: true, png: png(4, 4, 100) }; },
    getProd: okPng,
    diffPool: { submit: async (a: Uint8Array) => okDiff(a), close: async () => {} },
    progress: p,
  });

  expect(rec.ticks).toBe(2); // both the ok job and the throwing job ticked
  expect(rec.stops).toBe(1);
});
```

Append to `tests/pipeline/snapshot.test.ts`:

```typescript
import type { Progress } from "../../src/progress";

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("snapshotPipeline reports progress: start('Capturing prod', total), tick per job, stop", async () => {
  const config = ConfigSchema.parse({ dev: "https://dev.example.com", prod: "https://www.example.com", viewports: [1280] });
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await snapshotPipeline({
    config, db, createdAt: "t",
    discover: async () => ["/", "/pricing"], // 2 jobs
    captureFn: async () => ({ ok: true, png: png(100) }),
    progress: p,
  });

  expect(rec.starts).toEqual([{ total: 2, label: "Capturing prod" }]);
  expect(rec.ticks).toBe(2);
  expect(rec.stops).toBe(1);
});
```

(Note: `jobs`, `okPng`, `okDiff`, `png` already exist as helpers in these test files.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/pipeline/run.test.ts tests/pipeline/snapshot.test.ts`
Expected: FAIL — `progress` is not a known arg / `rec` stays empty (nothing drives it).

- [ ] **Step 3: Drive progress in `src/pipeline/run.ts`**

Add the type import near the top:

```typescript
import type { Progress } from "../progress";
```

Add the field to `RunPipelineArgs` (after `diffPool` or anywhere in the interface):

```typescript
  /** Optional progress reporter for the capture+diff phase. */
  progress?: Progress;
```

In `runPipeline`, after `const jobs = await args.listJobs();` add:

```typescript
    args.progress?.start(jobs.length, "Capturing dev + diffing");
```

Add a `finally` clause to the existing per-job `try/catch` so every job ticks exactly once — change the end of the per-job function from `} catch (err) { … saveComparison(db, runId, rec); }` to:

```typescript
      } catch (err) {
        rec.status = "error";
        rec.error = err instanceof Error ? err.message : String(err);
        saveComparison(db, runId, rec);
      } finally {
        args.progress?.tick();
      }
```

After the `await mapWithConcurrency(...)` call (still inside the outer `try`, before its closing brace) add:

```typescript
    args.progress?.stop();
```

(Do NOT add any progress call in the outer `catch (err)` / `finishRun(..., "failed")` path.)

- [ ] **Step 4: Drive progress in `src/pipeline/snapshot.ts`**

Add the type import:

```typescript
import type { Progress } from "../progress";
```

Add to `SnapshotPipelineArgs`:

```typescript
  progress?: Progress;
```

After the `const jobs = paths.flatMap(...)` line add:

```typescript
  args.progress?.start(jobs.length, "Capturing prod");
```

Wrap the per-job body in a `try/finally` so the tick fires once per job. Change the `mapWithConcurrency` callback body to:

```typescript
  await mapWithConcurrency(jobs, config.concurrency.screenshots, async (job) => {
    try {
      // capture() never throws; on failure it returns { ok:false, error }.
      const res = await args.captureFn(job.prodUrl, job.viewport, config);
      saveBaselineImage(db, {
        path: job.path, viewport: job.viewport, prodUrl: job.prodUrl,
        image: res.ok ? res.png : undefined,
        status: res.ok ? "ok" : "error",
        error: res.ok ? undefined : res.error,
      });
    } finally {
      args.progress?.tick();
    }
  });
```

After the map (before `writeSnapshot(...)`) add:

```typescript
  args.progress?.stop();
```

- [ ] **Step 5: Run to verify they pass**

Run: `bun test tests/pipeline/run.test.ts tests/pipeline/snapshot.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors. (Existing pipeline tests, which pass no `progress`, still pass — the calls are `args.progress?.…` no-ops.)

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/run.ts src/pipeline/snapshot.ts tests/pipeline/run.test.ts tests/pipeline/snapshot.test.ts
git commit -m "feat: drive progress from runPipeline and snapshotPipeline"
```

---

## Task 3: Forward progress through `runFlow` and wire the commands

**Files:**
- Modify: `src/pipeline/run-flow.ts`, `src/commands/run.ts`, `src/commands/snapshot.ts`
- Test: `tests/pipeline/run-flow.test.ts`

**Interfaces:**
- Consumes: `Progress` (Task 1); pipeline `progress?` args (Task 2); `makeProgress` (Task 1).
- Produces: `RunFlowArgs.progress?: Progress`, forwarded to `snapshotPipeline` (materialize) and `runPipeline`.

- [ ] **Step 1: Write the failing run-flow tests**

Append to `tests/pipeline/run-flow.test.ts` (add the type import at the top with the other imports, then the tests):

```typescript
import type { Progress } from "../../src/progress";

function fakeProgress() {
  const rec = { starts: [] as Array<{ total: number; label: string }>, ticks: 0, stops: 0 };
  const p: Progress = {
    start: (total, label) => { rec.starts.push({ total, label }); },
    tick: () => { rec.ticks++; },
    stop: () => { rec.stops++; },
  };
  return { p, rec };
}

test("runFlow drives two sequential phases on a materializing run", async () => {
  const db = openDb(":memory:");
  const { p, rec } = fakeProgress();

  await runFlow({
    config: cfg(), db, now: "t",
    discover: async () => ["/", "/pricing"], // 2 prod jobs (viewports [1280])
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool, progress: p,
  });

  expect(rec.starts.map((s) => s.label)).toEqual(["Capturing prod", "Capturing dev + diffing"]);
  expect(rec.starts.map((s) => s.total)).toEqual([2, 2]);
  expect(rec.ticks).toBe(4); // 2 prod + 2 dev
  expect(rec.stops).toBe(2);
});

test("runFlow drives one phase on a reused (frozen) baseline", async () => {
  const db = openDb(":memory:");
  // Materialize first WITHOUT progress.
  await runFlow({
    config: cfg(), db, now: "t1",
    discover: async () => ["/"],
    captureProd: async () => ({ ok: true, png: png(100) }),
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool,
  });
  // Second run reuses the baseline; only the dev phase runs.
  const { p, rec } = fakeProgress();
  await runFlow({
    config: cfg(), db, now: "t2",
    discover: async () => { throw new Error("frozen"); },
    captureProd: async () => { throw new Error("frozen"); },
    getDev: async () => ({ ok: true, png: png(150) }),
    diffPool, progress: p,
  });

  expect(rec.starts.map((s) => s.label)).toEqual(["Capturing dev + diffing"]);
  expect(rec.stops).toBe(1);
});
```

(Note: `cfg`, `png`, `diffPool` already exist as helpers in `run-flow.test.ts`. If a stray placeholder import line was added above, remove it — only `import type { Progress } from "../../src/progress";` is needed.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/pipeline/run-flow.test.ts`
Expected: FAIL — `progress` is not a known `RunFlowArgs` field / `rec` stays empty.

- [ ] **Step 3: Forward progress in `src/pipeline/run-flow.ts`**

Add the type import:

```typescript
import type { Progress } from "../progress";
```

Add to `RunFlowArgs`:

```typescript
  progress?: Progress;
```

In `runFlow`, pass `progress: args.progress` into the `snapshotPipeline({ ... })` call (materialize branch):

```typescript
    await snapshotPipeline({
      config, db, createdAt: args.now,
      discover: args.discover,
      captureFn: args.captureProd,
      progress: args.progress,
    });
```

And into the `runPipeline({ ... })` call:

```typescript
  await runPipeline({
    config, db, startedAt: args.now, prodBaseUrl: snapshot.prodBaseUrl,
    listJobs: async (): Promise<Job[]> => images.map((im) => ({
      path: im.path, viewport: im.viewport,
      devUrl: new URL(im.path, config.dev).toString(),
      prodUrl: im.prodUrl,
    })),
    getDev: args.getDev,
    getProd: async (job: Job) => {
      const im = byKey.get(`${job.path} ${job.viewport}`)!;
      return im.status === "ok" && im.image
        ? { ok: true, png: im.image }
        : { ok: false, error: im.error ?? "prod capture failed in snapshot" };
    },
    diffPool: args.diffPool,
    progress: args.progress,
  });
```

- [ ] **Step 4: Run the run-flow test to verify it passes**

Run: `bun test tests/pipeline/run-flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `src/commands/run.ts`**

Add the import:

```typescript
import { makeProgress } from "../progress";
```

Create the bar after the `DiffPool` is constructed (near `const diffPool = new DiffPool(...)`):

```typescript
  const progress = makeProgress();
```

Pass it into the `runFlow({ ... })` call (add the field alongside `diffPool`):

```typescript
      diffPool,
      progress,
```

- [ ] **Step 6: Wire `src/commands/snapshot.ts`**

Add the import:

```typescript
import { makeProgress } from "../progress";
```

Create the bar (near where the browser/db are set up, before the `try`):

```typescript
  const progress = makeProgress();
```

Pass it into the `snapshotPipeline({ ... })` call:

```typescript
      captureFn: (url, vw, cfg) => capture(browser, url, vw, cfg.stabilize, cfg.insecure),
      progress,
```

- [ ] **Step 7: Full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS across the suite; no type errors. (Commands now render a real bar to stderr; pipeline/run-flow tests use the fake recorder.)

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/run-flow.ts src/commands/run.ts src/commands/snapshot.ts tests/pipeline/run-flow.test.ts
git commit -m "feat: forward progress through runFlow; wire bars into run + snapshot"
```

---

## Task 4: Docs

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a progress note to the README**

In `README.md`, add a short paragraph at the end of the "## How it works" section (after the numbered list):

```markdown
While capturing and diffing, momus renders a progress bar to **stderr** — one
phase for prod capture (on a fresh baseline) and one for dev capture + diff. In a
non-TTY environment (CI, piped output) it prints a plain progress line
periodically instead of redrawing. stdout carries only the final summary, so
piping stdout to a file stays clean.
```

- [ ] **Step 2: Verify docs are inert and commit**

Run: `bun test`
Expected: PASS.

```bash
git add README.md
git commit -m "docs: note the run/snapshot progress bar"
```

---

## Self-Review

**1. Spec coverage:**
- §1 dependency + `Progress` seam (`makeProgress`, stderr, non-TTY periodic) → Task 1. ✓
- §2 pipeline hooks (`progress?`, start/tick-in-finally/stop; no progress in catch) → Task 2. ✓
- §3 phases (prod / dev; two sequential on materialize) → Task 2 labels + Task 3 forwarding, asserted by run-flow tests. ✓
- §4 wiring (`runFlow` forwards; both commands `makeProgress()`) → Task 3. ✓
- §5 edge cases (non-TTY periodic; error jobs still tick; map-throw leaves bar unstopped) → Task 2 (finally tick; stop only on success) + Task 2 error-job test. ✓
- §6 testing (fake-progress recorders in pipelines + run-flow; makeProgress render) → Tasks 1–3. ✓
- §7 docs + dep → Task 4 + Task 1. ✓

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code. (The run-flow test step calls out and removes a deliberately-shown placeholder import line — the correct import is stated explicitly.)

**3. Type consistency:** `Progress` (Task 1) is imported by `run.ts`/`snapshot.ts` (Task 2), `run-flow.ts` (Task 3), and the tests, all from `src/progress`. `makeProgress(stream?)` (Task 1) is called arg-less by both commands (Task 3). `RunPipelineArgs.progress?`, `SnapshotPipelineArgs.progress?`, `RunFlowArgs.progress?` all use the same `Progress` type and the same labels (`"Capturing prod"`, `"Capturing dev + diffing"`). ✓

**Note for the implementer:** Task 3's command wiring has no dedicated unit test — the `run-flow.test.ts` progress tests cover the pipeline threading, and `bun test && bunx tsc --noEmit` covers the command edits. Do not add a real-Chromium test for the bar.
