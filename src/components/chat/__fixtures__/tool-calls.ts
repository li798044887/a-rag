/** Story 専用の ToolCall フィクスチャ。tool-steps / agent-activity で共用。
 *  各 input/output は実際の描画分岐（vector_search.hits, rerank.selected,
 *  answer のトークン集計、retrieve.result）に合う形にしてある。 */
import type { ToolCall } from "@/lib/types";

export const SAMPLE_STEPS: ToolCall[] = [
  {
    id: "s1",
    name: "rewrite_query",
    label: "クエリ書き換え",
    status: "done",
    durationMs: 320,
    input: { query: "Scrum 移行はいつ決まった？" },
    output: { result: "Scrum 正式移行の決定時期 / 移行内容 / 体制変更" },
    summary: "3つの観点に展開",
  },
  {
    id: "s2",
    name: "retrieve",
    label: "ハイブリッド検索",
    status: "done",
    durationMs: 1840,
    input: { query: "Scrum 移行 決定 議事録" },
    output: null,
    summary: "12件ヒット",
  },
  {
    id: "s2a",
    name: "vector_search",
    parentId: "s2",
    label: "ベクトル検索",
    status: "done",
    durationMs: 640,
    input: { model: "text-embedding-3-large" },
    output: {
      hits: [
        { title: "2026年4月 全体定例 議事録", heading: "開発プロセス改定", score: 0.88 },
        { title: "開発体制 Wiki", heading: "アジャイル移行方針", score: 0.71 },
        { title: "#dev-process", heading: "スプリント長の議論", score: 0.63 },
      ],
    },
    summary: "",
  },
  {
    id: "s2b",
    name: "bm25_search",
    parentId: "s2",
    label: "BM25 検索",
    status: "done",
    durationMs: 210,
    input: {},
    output: {
      hits: [
        { title: "2026年4月 全体定例 議事録", heading: "決定事項", score: 12.4 },
        { title: "Q2 OKR ドラフト", heading: "プロセス改善", score: 8.1 },
      ],
    },
    summary: "",
  },
  {
    id: "s2c",
    name: "rerank",
    parentId: "s2",
    label: "再ランク",
    status: "done",
    durationMs: 720,
    input: { model: "rerank-3", top_n: 5 },
    output: {
      selected: [
        { id: "src-1", score: 0.94, title: "2026年4月 全体定例 議事録" },
        { id: "src-2", score: 0.62, title: "開発体制 Wiki" },
      ],
    },
    summary: "上位2件を採用",
  },
  {
    id: "s3",
    name: "answer",
    label: "回答生成",
    status: "done",
    durationMs: 2110,
    input: { model: "claude-opus-4-8" },
    output: { inputTokens: 4820, outputTokens: 612, totalTokens: 5432, cachedInputTokens: 3200 },
    summary: "引用付きで回答",
  },
];

/** 実行途中（answer が running）の状態。 */
export const RUNNING_STEPS: ToolCall[] = [
  ...SAMPLE_STEPS.slice(0, 5),
  { ...SAMPLE_STEPS[5], status: "running", durationMs: 0, output: null },
];
