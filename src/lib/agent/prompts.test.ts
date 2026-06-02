import { describe, it, expect } from "vitest";
import { getAgentPrompts } from "./prompts";

describe("getAgentPrompts", () => {
  it("zh 返回中文系统提示词且体现 RAG 专家要点", () => {
    const p = getAgentPrompts("zh");
    expect(p.system).toContain("仅");
    expect(p.system).toContain("出处");
    expect(p.system).toContain("中文");
    expect(p.system).toContain("不要");
    expect(p.system).not.toContain("ください");
  });
  it("ja 返回日语系统提示词", () => {
    const p = getAgentPrompts("ja");
    expect(p.system).toContain("ください");
    expect(p.system).toContain("出典番号");
  });
  it("两种语言的工具标签/兜底文案齐全", () => {
    for (const loc of ["zh", "ja"] as const) {
      const p = getAgentPrompts(loc);
      expect(p.toolLabels.retrieve).toBeTruthy();
      expect(p.toolLabels.fetch_document).toBeTruthy();
      expect(p.runningSummaries.retrieve).toBeTruthy();
      expect(p.fallback.noSources).toBeTruthy();
      expect(p.fallback.genFailed).toBeTruthy();
      expect(p.toolDescriptions.retrieve).toBeTruthy();
      expect(p.stageLabels.vector_search).toBeTruthy();
    }
  });
  it("buildUserContent: 有附件时按 locale 给出附件提示", () => {
    const zh = getAgentPrompts("zh");
    const out = zh.buildUserContent("成本是多少", ["a.pdf"], ["doc1"]);
    expect(out).toContain("a.pdf");
    expect(out).toContain("retrieve");
    expect(out).toContain("成本是多少");
  });
  it("buildUserContent: 无附件时原样返回查询", () => {
    const zh = getAgentPrompts("zh");
    expect(zh.buildUserContent("你好", [], [])).toBe("你好");
  });
});
