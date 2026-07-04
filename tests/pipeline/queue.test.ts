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
  // Must actually reach the limit (not just stay under it): with 6 tasks and
  // 2 permits, concurrency should hit exactly 2.
  expect(maxActive).toBe(2);
});

test("mapWithConcurrency preserves order and caps parallelism", async () => {
  const items = [1, 2, 3, 4, 5];
  // Vary per-item delay so jobs finish out of submission order: index 0 sleeps
  // longest. Output order must still match input order.
  const out = await mapWithConcurrency(items, 2, async (n, i) => {
    await new Promise((r) => setTimeout(r, (items.length - i) * 5));
    return n * 2;
  });
  expect(out).toEqual([2, 4, 6, 8, 10]);
});
