import { afterEach, expect, test, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateText(...a),
  Output: { object: (cfg: unknown) => cfg, text: () => ({}) },
}));

import { verifyAnswer } from "@/lib/agent/verify";
import { getAgentPrompts } from "@/lib/agent/prompts";

const prompts = getAgentPrompts("ja");
const model = "m" as never;
const sources = [{ n: 1, title: "A", heading: "h", snippet: "トークンは24時間で失効する" }];

afterEach(() => generateText.mockReset());

test("全主張が裏付けられていれば revise しない", async () => {
  generateText.mockResolvedValueOnce({
    output: { unsupported: [] },
    totalUsage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
  });
  const r = await verifyAnswer({ query: "q", answer: "失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.checkableClaims).toBe(1);
  expect(r.revised).toBeNull();
  expect((r as { verifyUsage?: unknown }).verifyUsage).toMatchObject({ inputTokens: 12, outputTokens: 3, totalTokens: 15 });
  expect((r as { reviseUsage?: unknown }).reviseUsage).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("未裏付けがあり maxRevisions>0 なら訂正本文を返す", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      claims: [
        { text: "48時間で失効する", citedNums: [1], verdict: "unsupported", reason: "出典は24時間と記載" },
      ],
    },
    totalUsage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
  });
  generateText.mockResolvedValueOnce({
    text: "24時間で失効します[1]。",
    totalUsage: { inputTokens: 30, outputTokens: 9, totalTokens: 39 },
  });
  const r = await verifyAnswer({ query: "q", answer: "48時間で失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual(["48時間で失効する"]);
  expect(r.revised).toBe("24時間で失効します[1]。");
  expect((r as { verifyUsage?: unknown }).verifyUsage).toMatchObject({ totalTokens: 24 });
  expect((r as { reviseUsage?: unknown }).reviseUsage).toMatchObject({ totalTokens: 39 });
  expect(generateText).toHaveBeenCalledTimes(2);
  expect(JSON.parse(generateText.mock.calls[1][0].prompt)).toMatchObject({ query: "q" });
});

test("claim 形式の supported / not_a_claim は revise しない", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      claims: [
        { text: "トークンは24時間で失効する", citedNums: [1], verdict: "supported" },
        { text: "認証トークンについて", citedNums: [], verdict: "not_a_claim" },
      ],
    },
  });
  const r = await verifyAnswer({ query: "q", answer: "トークンは24時間で失効します[1]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("存在しない引用番号を返した claim は未裏付け扱いにする", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      claims: [
        { text: "トークンは24時間で失効する", citedNums: [99], verdict: "supported" },
      ],
    },
  });
  generateText.mockResolvedValueOnce({ text: "トークンは24時間で失効します[1]。" });
  const r = await verifyAnswer({ query: "q", answer: "トークンは24時間で失効します[99]。", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual(["トークンは24時間で失効する"]);
  expect(r.revised).toBe("トークンは24時間で失効します[1]。");
  expect(generateText).toHaveBeenCalledTimes(2);
});

test("資料不足の明示は未裏付け主張から除外して revise しない", async () => {
  generateText.mockResolvedValueOnce({ output: { unsupported: ["企业当前收入在行业中的水平"] } });
  const zhPrompts = getAgentPrompts("zh");
  const answer = "无法从现有资料中判断企业当前收入在行业中的水平。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts: zhPrompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("資料不足と追加情報依頼だけの中国語回答は unsupported を空にする", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      unsupported: [
        "关于公司目前的收入在业内的水平，根据现有资料，无法确定具体的数据和比较情况。",
      ],
    },
  });
  const zhPrompts = getAgentPrompts("zh");
  const answer =
    "关于公司目前的收入在业内的水平，根据现有资料，无法确定具体的数据和比较情况。" +
    "如果您能提供具体的公司名称或相关财务数据，我可以尝试更深入地为您查找相关信息。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts: zhPrompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.checkableClaims).toBe(0);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("中国語の該当記録なし回答は検証対象の主張なしにする", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      claims: [
        { text: "2025年10月观看的电影", citedNums: [], verdict: "unsupported" },
      ],
    },
  });
  const zhPrompts = getAgentPrompts("zh");
  const answer =
    "关于你在 2025年10月观看的电影，当前资料库中没有相关记录，无法提供具体信息。" +
    "如果还有其他问题或需要帮助，请随时告诉我。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts: zhPrompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.checkableClaims).toBe(0);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("資料未記載とわからない旨だけの日本語回答は unsupported を空にする", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      unsupported: ["自社の収入が業界においてどのレベルにあるかの具体的な情報"],
    },
    totalUsage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
  });
  const answer =
    "**現在の収入の業界比較について**\n\n" +
    "- 社内資料には自社の収入が業界においてどのレベルにあるかの具体的な情報は含まれていない。[1][2][3][4][5][6]\n" +
    "- そのため、収入レベルの具体的な業界比較は「わからない」と答えるしかありません。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(r.verifyUsage).toMatchObject({ totalTokens: 24 });
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("論点を表すだけの名詞句は unsupported から除外する", async () => {
  generateText.mockResolvedValueOnce({
    output: {
      unsupported: [
        "自社の収入が業界においてどのレベルにあるかの具体的な情報",
        "企业当前收入在行业中的水平",
      ],
    },
  });
  const answer = "質問は収入の業界比較についてです。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("資料不足の明示と未裏付け主張が混在する場合は主張だけ revise する", async () => {
  generateText.mockResolvedValueOnce({
    output: { unsupported: ["企業の現在収入", "48時間で失効する"] },
  });
  generateText.mockResolvedValueOnce({ text: "企業の現在収入は資料から判断できません。24時間で失効します[1]。" });
  const answer = "企業の現在収入は資料から判断できません。48時間で失効します[1]。";
  const r = await verifyAnswer({ query: "q", answer, sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual(["48時間で失効する"]);
  expect(r.revised).toBe("企業の現在収入は資料から判断できません。24時間で失効します[1]。");
  expect(generateText).toHaveBeenCalledTimes(2);
});

test("maxRevisions=0 なら未裏付けでも revise しない", async () => {
  generateText.mockResolvedValueOnce({ output: { unsupported: ["x"] } });
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 0 });
  expect(r.revised).toBeNull();
  expect(generateText).toHaveBeenCalledTimes(1);
});

test("検証 LLM が失敗したら未裏付けなし扱いで素通し", async () => {
  generateText.mockRejectedValueOnce(new Error("boom"));
  const r = await verifyAnswer({ query: "q", answer: "a[1]", sources, model, prompts, maxRevisions: 1 });
  expect(r.unsupported).toEqual([]);
  expect(r.revised).toBeNull();
});
