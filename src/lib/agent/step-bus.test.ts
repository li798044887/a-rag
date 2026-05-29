import { expect, test } from "vitest";
import { StepBus } from "@/lib/agent/step-bus";
import type { AgentEvent } from "@/lib/types";

const ev = (text: string): AgentEvent => ({ type: "answer-delta", text });

test("drains pushed events in order then ends on close", async () => {
  const bus = new StepBus();
  bus.push(ev("a"));
  bus.push(ev("b"));
  bus.close();
  const got: string[] = [];
  for await (const e of bus) if (e.type === "answer-delta") got.push(e.text);
  expect(got).toEqual(["a", "b"]);
});

test("delivers events pushed after the consumer started waiting", async () => {
  const bus = new StepBus();
  const got: string[] = [];
  const drain = (async () => {
    for await (const e of bus) if (e.type === "answer-delta") got.push(e.text);
  })();
  // consumer is now awaiting; push asynchronously then close.
  await Promise.resolve();
  bus.push(ev("x"));
  bus.push(ev("y"));
  bus.close();
  await drain;
  expect(got).toEqual(["x", "y"]);
});
