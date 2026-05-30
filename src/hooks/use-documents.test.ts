import { expect, test } from "vitest";
import { mergeNextPage } from "@/hooks/use-documents";
import type { DocumentSummary } from "@/lib/types";

const doc = (id: string): DocumentSummary => ({
  id, filename: `${id}.pdf`, mime: "application/pdf", size: 1, page_count: 1,
  status: "ready", created_at: "2026-05-31", chunk_count: 1, latest_job_id: null, error: null,
});

test("mergeNextPage appends and dedupes by id", () => {
  const prev = [doc("a"), doc("b")];
  const merged = mergeNextPage(prev, [doc("b"), doc("c")]);
  expect(merged.map((d) => d.id)).toEqual(["a", "b", "c"]);
});
