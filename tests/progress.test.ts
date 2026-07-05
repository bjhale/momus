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
