import { expect, test } from "vitest";
import { uploadActionFor } from "@/hooks/use-uploads";

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
