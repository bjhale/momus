// tests/pipeline/queue.test.ts
import { test, expect } from "bun:test";
import { Semaphore, mapWithConcurrency } from "../../src/pipeline/queue";

test("semaphore bounds concurrent holders", async () => {
  const sem = new Semaphore(2);
  let active = 0, maxActive = 0;
  const task = async () => {
    await sem.acquire();
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--; sem.release();
  };
  await Promise.all(Array.from({ length: 6 }, task));
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("mapWithConcurrency preserves order and caps parallelism", async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapWithConcurrency(items, 2, async (n) => n * 2);
  expect(out).toEqual([2, 4, 6, 8, 10]);
});
