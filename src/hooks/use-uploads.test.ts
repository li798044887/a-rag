import { expect, test } from "vitest";
import { activeJobIds, reconnectKey, uploadActionFor } from "@/hooks/use-uploads";
import type { StagedFile } from "@/lib/types";

test("uploading は upload POST を中断する", () => {
  expect(uploadActionFor("uploading")).toBe("abort");
});

test("queued はサーバ側キャンセルAPIを呼ぶ", () => {
  expect(uploadActionFor("queued")).toBe("cancel");
});

test("processing は取り消し不可", () => {
  expect(uploadActionFor("processing")).toBe("none");
});

test("ready / error / skipped はローカル除去のみ", () => {
  expect(uploadActionFor("ready")).toBe("remove");
  expect(uploadActionFor("error")).toBe("remove");
  expect(uploadActionFor("skipped")).toBe("remove");
});

test("activeJobIds は queued/processing の jobId のみ返す", () => {
  const files: StagedFile[] = [
    { id: "1", name: "a", size: 1, status: "queued", progress: 0, jobId: "j1" },
    { id: "2", name: "b", size: 1, status: "processing", progress: 0, jobId: "j2" },
    { id: "3", name: "c", size: 1, status: "ready", progress: 100, jobId: "j3" },
    { id: "4", name: "d", size: 1, status: "uploading", progress: 0 },
  ];
  expect(activeJobIds(files)).toEqual(["j1", "j2"]);
});

test("reconnectKey はソート・重複排除して安定キーを返す", () => {
  expect(reconnectKey(["j2", "j1", "j2"])).toBe("j1,j2");
  expect(reconnectKey([])).toBe("");
});
