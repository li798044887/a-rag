import { expect, test } from "vitest";
import { Semaphore } from "@/lib/agent/semaphore";

test("caps concurrent executions at max", async () => {
  const sema = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const task = () =>
    sema.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return true;
    });
  await Promise.all(Array.from({ length: 6 }, task));
  expect(peak).toBe(2);
});

test("rounds max below 1 up to 1", async () => {
  const sema = new Semaphore(0);
  let active = 0;
  let peak = 0;
  const task = () =>
    sema.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
  await Promise.all(Array.from({ length: 3 }, task));
  expect(peak).toBe(1);
});

test("returns each task's resolved value", async () => {
  const sema = new Semaphore(2);
  const results = await Promise.all([1, 2, 3].map((n) => sema.run(async () => n * 2)));
  expect(results).toEqual([2, 4, 6]);
});

test("releases the slot even when a task throws", async () => {
  const sema = new Semaphore(1);
  await expect(sema.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  await expect(sema.run(async () => "ok")).resolves.toBe("ok");
});
