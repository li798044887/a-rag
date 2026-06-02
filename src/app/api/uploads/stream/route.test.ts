import { expect, test } from "vitest";
import { formatFrame, isTerminalJobStatus } from "./route";

test("ready/error は終端、それ以外は継続", () => {
  expect(isTerminalJobStatus("ready")).toBe(true);
  expect(isTerminalJobStatus("error")).toBe(true);
  expect(isTerminalJobStatus("processing")).toBe(false);
  expect(isTerminalJobStatus("queued")).toBe(false);
});

test("formatFrame は jobId 付き SSE フレームを返す", () => {
  const frame = formatFrame("j1", { status: "ready", progress: 100, stage_detail: "" });
  expect(frame).toBe(`data: {"jobId":"j1","status":"ready","progress":100,"stage_detail":""}\n\n`);
});
