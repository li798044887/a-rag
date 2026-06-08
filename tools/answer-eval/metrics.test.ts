import { expect, test } from "vitest";
import { _scaffold } from "./metrics.ts";

test("scaffold wiring works", () => {
  expect(_scaffold()).toBe(true);
});
