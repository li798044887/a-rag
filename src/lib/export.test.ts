import { expect, test } from "vitest";
import { buildThreadMarkdown } from "@/lib/export";
import type { Turn } from "@/lib/types";

function turn(partial: Partial<Turn>): Turn {
  return {
    query: "", steps: [], answer: "", streaming: false, citationMap: {},
    sourceIds: [], sources: [], tokens: 0, durationMs: 0, status: "done", attachments: [],
    ...partial,
  };
}

test("buildThreadMarkdown includes every turn's Q&A in order", () => {
  const md = buildThreadMarkdown([
    turn({ query: "組織再編の論点は？", answer: "論点は A[1]。" }),
    turn({ query: "そのリスクは？", answer: "リスクは B。" }),
  ]);
  expect(md.indexOf("組織再編の論点は？")).toBeGreaterThanOrEqual(0);
  expect(md.indexOf("そのリスクは？")).toBeGreaterThan(md.indexOf("組織再編の論点は？"));
  expect(md).toContain("論点は A[1]。");
  expect(md).toContain("リスクは B。");
});

test("buildThreadMarkdown aggregates and de-dupes sources by id", () => {
  const s = (id: string, title: string) =>
    ({ id, type: "doc" as const, title, path: `/p/${id}`, author: "", date: "", sections: [] });
  const md = buildThreadMarkdown([
    turn({ query: "Q1", answer: "A1", sources: [s("d1", "商法")] }),
    turn({ query: "Q2", answer: "A2", sources: [s("d1", "商法"), s("d2", "定款")] }),
  ]);
  // d1 は 1 回だけ、d2 も出る
  expect(md.match(/商法/g)?.length).toBe(1);
  expect(md).toContain("定款");
  expect(md).toContain("参考資料");
});

test("buildThreadMarkdown omits 参考資料 section when no sources exist", () => {
  const md = buildThreadMarkdown([turn({ query: "Q", answer: "A" })]);
  expect(md).not.toContain("参考資料");
  expect(md).toContain("## Q");
});

test("buildThreadMarkdown returns empty string for no turns", () => {
  expect(buildThreadMarkdown([])).toBe("");
});
