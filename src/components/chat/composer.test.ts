import { expect, test } from "vitest";
import { composerSubmitState } from "@/components/chat/composer";
import type { StagedFile } from "@/lib/types";

function file(status: StagedFile["status"]): StagedFile {
  return { id: status, name: "f", size: 1, status, progress: 0 };
}

test("blocks submit while an attachment is uploading or processing", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("uploading")], running: false }))
    .toEqual({ pending: true, canSubmit: false });
  expect(composerSubmitState({ value: "質問", attachments: [file("processing")], running: false }))
    .toEqual({ pending: true, canSubmit: false });
});

test("allows submit once attachments are ready", () => {
  expect(composerSubmitState({ value: "", attachments: [file("ready")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "質問", attachments: [file("ready")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
});

test("text alone allows submit; empty with no ready attachment does not", () => {
  expect(composerSubmitState({ value: "質問", attachments: [], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "  ", attachments: [], running: false }))
    .toEqual({ pending: false, canSubmit: false });
});

test("skipped/error attachments do not block, but need text or a ready file", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("skipped")], running: false }))
    .toEqual({ pending: false, canSubmit: true });
  expect(composerSubmitState({ value: "", attachments: [file("error")], running: false }))
    .toEqual({ pending: false, canSubmit: false });
});

test("running disables submit regardless", () => {
  expect(composerSubmitState({ value: "質問", attachments: [file("ready")], running: true }))
    .toEqual({ pending: false, canSubmit: false });
});
