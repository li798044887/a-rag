import { describe, it, expect } from "vitest";
import { getAgentPrompts } from "./prompts";
import { buildSystemPrompt, AGENT_CFG_DEFAULTS } from "./config";

describe("getAgentPrompts", () => {
  it("zh 的系统提示词（默认配置）体现 RAG 专家要点", () => {
    const sys = buildSystemPrompt(AGENT_CFG_DEFAULTS, "zh");
    expect(sys).toContain("仅");
    expect(sys).toContain("出处");
    expect(sys).toContain("中文");
    expect(sys).toContain("必须始终使用中文回答");
    expect(sys).toContain("不要");
    expect(sys).not.toContain("ください");
  });
  it("ja 的系统提示词（默认配置）为日语", () => {
    const sys = buildSystemPrompt(AGENT_CFG_DEFAULTS, "ja");
    expect(sys).toContain("必ず日本語で回答");
    expect(sys).toContain("ください");
    expect(sys).toContain("出典番号");
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
  it("grade/verify/revise プロンプトが zh/ja 双方で揃う", () => {
    for (const loc of ["zh", "ja"] as const) {
      const p = getAgentPrompts(loc);
      expect(p.grade.label.length).toBeGreaterThan(0);
      expect(p.grade.system.length).toBeGreaterThan(0);
      expect(p.grade.done(1, 3).length).toBeGreaterThan(0);
      expect(p.grade.retry.length).toBeGreaterThan(0);
      expect(p.grade.retryLabel.length).toBeGreaterThan(0);
      expect(p.queryRewrite.system.length).toBeGreaterThan(0);
      expect(p.verify.system.length).toBeGreaterThan(0);
      expect(p.verify.done(0).length).toBeGreaterThan(0);
      expect(p.verify.done(2).length).toBeGreaterThan(0);
      expect(p.revise.system.length).toBeGreaterThan(0);
      expect(p.revise.done.length).toBeGreaterThan(0);
    }
  });
  it("revise プロンプトも locale の回答言語を強制する", () => {
    expect(getAgentPrompts("zh").revise.system).toContain("必须始终使用中文回答");
    expect(getAgentPrompts("ja").revise.system).toContain("必ず日本語で回答");
  });
  it("再検索ラベルは locale ごとに短く表示できる", () => {
    expect(getAgentPrompts("ja").grade.retryLabel).toBe("再検索");
    expect(getAgentPrompts("zh").grade.retryLabel).toBe("重新检索");
  });
  it("verify プロンプトは名詞句を未裏付け主張にしないよう指示する", () => {
    expect(getAgentPrompts("zh").verify.system).toContain("名词短语");
    expect(getAgentPrompts("ja").verify.system).toContain("名詞句");
  });
  it("verify/revise プロンプトは引用番号単位の検証を指示する", () => {
    expect(getAgentPrompts("ja").verify.system).toContain("citedNums");
    expect(getAgentPrompts("ja").verify.system).toContain("引用番号");
    expect(getAgentPrompts("ja").revise.system).toContain("直前の主張");
    expect(getAgentPrompts("zh").verify.system).toContain("citedNums");
    expect(getAgentPrompts("zh").verify.system).toContain("出处编号");
    expect(getAgentPrompts("zh").revise.system).toContain("紧邻主张");
  });
});
