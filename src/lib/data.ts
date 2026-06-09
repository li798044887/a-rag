/** Seed / sample data for the agentic-RAG prototype.
 *
 * In a production deployment these come from a vector DB + connectors; here the
 * retriever (lib/agent/retriever.ts) treats this module as its corpus so the
 * agent flow runs end-to-end without external infrastructure. */

import type { Locale } from "@/i18n/config";
import type {
  CitationMap,
  CompletedThread,
  ModelOption,
  ScopePreset,
  Source,
  SourceConnector,
  SuggestedPrompt,
  ThreadSummary,
} from "@/lib/types";

export const SAMPLE_SOURCES: Source[] = [
  {
    id: "src-1",
    type: "meeting",
    title: "製品MTG 議事録 — 2026-04-12",
    path: "meetings/2026-04-12-product-mtg.md",
    author: "記録: 田中 (PdM)",
    date: "2026-04-12",
    sections: [
      {
        id: "s1-1",
        heading: "前回からの宿題",
        body: "・スプリント計画ツールの比較 (Linear vs Jira vs ClickUp) → 担当: 佐藤\n・チームトポロジー再編案 → 担当: 山田\n・QA自動化のKPI設計 → 担当: 中村",
      },
      {
        id: "s1-2",
        heading: "アジャイル移行 — 決定事項",
        body: "5月第2スプリント (2026-05-11 開始) より、プロダクト本部の3チームを対象にScrumへ正式移行することで合意。\n\n• スプリント長: 2週間 (固定)\n• Daily Stand-up: 10:00–10:15 JST\n• Sprint Planning: 月曜AM (3h上限)\n• Retrospective: 金曜PM (90min)\n• 既存のWBSベース運用は5月末で廃止\n• Scrum Master候補: 山田 (Platform), 中村 (Growth), 佐々木 (Mobile)",
        highlight: true,
      },
      {
        id: "s1-3",
        heading: "リスク・懸念",
        body: "営業との納期コミットメントとの整合性が課題。プロダクトオーナー(PO)経由でのみ受付に変更し、スプリント外の差し込みは明示的にトレードオフを提示する運用とする。",
      },
      {
        id: "s1-4",
        heading: "次回まで",
        body: "・移行ガイドの初版作成 (山田, 5/2)\n・トレーニングセッション日程確定 (田中, 4/26)\n・既存タスクの棚卸し (各チームリード, 5/1)",
      },
    ],
  },
  {
    id: "src-2",
    type: "wiki",
    title: "Engineering Wiki: アジャイル移行プラン v3",
    path: "wiki/engineering/agile-migration-v3",
    author: "山田 健 · 最終更新 2026-04-18",
    date: "2026-04-18",
    sections: [
      {
        id: "s2-1",
        heading: "背景と目的",
        body: "これまでのWBS+ガントベースの運用は、要件の不確実性が高い新規プロダクトでは硬直化が目立っていた。短いフィードバックサイクルと優先度の動的な再評価を可能にするため、Scrumを採用する。",
      },
      {
        id: "s2-2",
        heading: "対象チームとタイムライン",
        body: "対象: Platform / Growth / Mobile の3チーム (計18名)\n開始: 2026-05-11 (5月第2スプリント)\n移行完了判定: 2026-07-31 (3スプリント分の安定運用)",
        highlight: true,
      },
      {
        id: "s2-3",
        heading: "セレモニー設計",
        body: "• Sprint Planning (月AM, 3h上限) — POが優先度提示、チームがコミット\n• Daily Stand-up (10:00 JST, 15min)\n• Sprint Review (金AM, 60min, ステークホルダー招待)\n• Retrospective (金PM, 90min, KPT)\n• Backlog Refinement (水PM, 60min)",
      },
      {
        id: "s2-4",
        heading: "メトリクス",
        body: "Velocity, Sprint Goal達成率, Cycle Time (Lead Time for Changes), Escaped Defect Rateを計測。Lookerダッシュボードを準備中 (オーナー: 中村)。",
      },
    ],
  },
  {
    id: "src-3",
    type: "slack",
    title: "#product-leadership — アジャイル移行スレッド",
    path: "slack/product-leadership/1713158400",
    author: "12 messages · 2026-04-15",
    date: "2026-04-15",
    sections: [
      {
        id: "s3-1",
        heading: "田中 (PdM) 14:02",
        body: "昨日のMTGでScrum移行が正式に決まりました。対象は Platform / Growth / Mobile の3チーム、5月第2スプリント開始予定です。",
      },
      {
        id: "s3-2",
        heading: "佐藤 (Eng Manager) 14:08",
        body: "ありがとうございます！Scrum Master の人選は山田/中村/佐々木で確定で良いですか？それぞれにブロックされる稼働がどの程度になるかは見えてますか？",
      },
      {
        id: "s3-3",
        heading: "山田 14:15",
        body: "@佐藤 概ね20%くらいの想定です。最初の2スプリントは多めに見て30%確保しておきたい。",
        highlight: true,
      },
      {
        id: "s3-4",
        heading: "田中 (PdM) 14:22",
        body: "了解です。移行ガイドの初版は5/2までに山田さんが用意してくれます。トレーニングは4/26までに日程を固めます。",
      },
    ],
  },
  {
    id: "src-4",
    type: "doc",
    title: "Q2 OKR ドキュメント",
    path: "docs/okr/2026-q2.md",
    author: "経営企画 · 2026-04-01",
    date: "2026-04-01",
    sections: [
      {
        id: "s4-1",
        heading: "プロダクト本部 KR-3",
        body: "プロダクト本部はQ2末までにアジャイル運用への移行を完了し、Velocityおよびリリース頻度をベースラインとして確立する。",
      },
    ],
  },
];

export const SAMPLE_ANSWER_TEXT = `先月（2026年4月）の議事録によると、**Scrumへの正式移行が決定**しています。主な内容は次のとおりです。

**決定事項**
- 対象は Platform / Growth / Mobile の3チーム (計18名) [1][2]
- 開始は 2026年5月第2スプリント (5/11〜) [1][2]
- スプリント長は2週間固定、Daily 10:00 JST、Planning 月AM、Retro 金PM [1]
- 既存のWBSベース運用は5月末で廃止 [1]

**Scrum Master**
山田 (Platform)、中村 (Growth)、佐々木 (Mobile) で確定。初期2スプリントは稼働を30%程度確保 [1][3]。

**移行完了判定**
3スプリント分の安定運用 (2026-07-31目処) で完了とみなす [2]。

**運用上の留意点**
営業からの納期コミットはPO経由のみ受付に変更され、スプリント外の差し込みは明示的にトレードオフを提示する運用となります [1]。

**次のアクション**
- 4/26: トレーニング日程確定 (田中)
- 5/2: 移行ガイド v1 (山田)
- 5/1: 既存タスク棚卸し (各チームリード) [1]`;

export const CITATION_MAP: CitationMap = {
  1: { sourceId: "src-1", sectionId: "s1-2" },
  2: { sourceId: "src-2", sectionId: "s2-2" },
  3: { sourceId: "src-3", sectionId: "s3-3" },
  4: { sourceId: "src-4", sectionId: "s4-1" },
};

export const SAMPLE_THREADS: ThreadSummary[] = [
  { id: "th-current", title: "アジャイル移行の決定事項", updated: "今", pinned: false, active: true },
  { id: "th-1", title: "Q1リリースのインシデント振り返り", updated: "2時間前" },
  { id: "th-2", title: "採用面接ガイドラインの最新版は？", updated: "昨日" },
  { id: "th-3", title: "PostgreSQLのフェイルオーバ手順", updated: "2日前" },
  { id: "th-4", title: "人事評価サイクルの変更点", updated: "3日前" },
  { id: "th-5", title: "デザインシステム v2 の利用ガイド", updated: "先週" },
  { id: "th-6", title: "SOC 2 監査の社内準備", updated: "先週" },
  { id: "th-7", title: "GraphQLからtRPCへの移行RFC", updated: "2週間前" },
  { id: "th-8", title: "オンボーディング資料の所在", updated: "3週間前" },
];

/** Pre-baked snapshots of past conversations (instant, no re-run). */
export const COMPLETED_THREADS: Record<string, CompletedThread> = {
  "th-1": {
    query: "Q1リリースのインシデントを振り返って、根本原因と再発防止策を教えて",
    answerText:
      "Q1に発生した主要なインシデントは**3件**でした。\n\n**インシデント一覧**\n- INC-2026-014 (2/8): 認証サービスのJWTキーローテーション失敗 — 影響42分 [1]\n- INC-2026-019 (2/22): 検索インデックスのシャード不整合 — 一部クエリで結果欠落 [2]\n- INC-2026-023 (3/14): ウェブフック輻輳による重複処理 [3]\n\n**共通根本原因**\n- ロールバック手順のRunbook不足 [1][3]\n- デプロイ前検証のカナリア不足 [2]\n\n**再発防止策 (Q2採用済)**\n- 全サービスでRunbookの作成を必須化\n- Canaryデプロイを全てのクリティカルパスに適用\n- ウェブフック処理の冪等性必須化 [3]",
    tokens: 612,
    durationMs: 3120,
  },
  "th-2": {
    query: "採用面接ガイドラインの最新版はどこにありますか？",
    answerText:
      "最新の採用面接ガイドラインは **v4.2 (2026-04-05更新)** で、People Wikiに公開されています [2]。\n\n**主な変更点 (v4.1→v4.2)**\n- コーディング課題の時間を 90分→ 75分に短縮 [2]\n- システム設計面接で \"スケーラビリティ\" ルーブリックを追加\n- カルチャー面接のスコアリングを定量化 (3評価軸) [1]\n\n**関連リンク**\n- 面接評価シート v3.1 [1]\n- レファレンスチェックスクリプト [3]",
    tokens: 318,
    durationMs: 1840,
  },
  "th-3": {
    query: "PostgreSQLのフェイルオーバ手順を教えてください",
    answerText:
      "本番 PostgreSQLクラスタ (Patroni構成) のフェイルオーバ手順です [1]。\n\n**自動フェイルオーバ (推奨)**\nPatroni が30秒以上のリーダー不在を検知したら自動でフェイルオーバ [1][2]。ダウンタイムは通常 8〜15秒。\n\n**手動フェイルオーバ**\n1. `patronictl list` でクラスタ状態確認\n2. `patronictl failover --master <primary> --candidate <replica>` [1]\n3. フェイルオーバをPagerDutyと#ops-alertsに通知\n4. レプリケーション復旧を確認 [3]\n\n**注意点**\nReplicaのWAL遅延が10MB以上の場合は、遅延解消を待つか、データロスを許容するかの判断が必要です [1]。",
    tokens: 405,
    durationMs: 2210,
  },
};

const SUGGESTED_PROMPTS_JA: SuggestedPrompt[] = [
  { icon: "meeting", label: "先月の議事録でアジャイル移行について何が決まったか教えて", tag: "議事録" },
  { icon: "book", label: "デザインシステム v2 のボタンコンポーネントの使い方は？", tag: "Wiki" },
  { icon: "hash", label: "Slackで話題になった採用フロー改善案をまとめて", tag: "Slack" },
  { icon: "table", label: "Q1のAARRR指標の前年比をSQLで集計して", tag: "BI" },
];

const SUGGESTED_PROMPTS_ZH: SuggestedPrompt[] = [
  { icon: "meeting", label: "上个月的会议纪要里，敏捷转型有哪些决定事项？", tag: "会议纪要" },
  { icon: "book", label: "设计系统 v2 的按钮组件怎么用？", tag: "Wiki" },
  { icon: "hash", label: "整理一下 Slack 里讨论的招聘流程改善方案", tag: "Slack" },
  { icon: "table", label: "用 SQL 汇总 Q1 AARRR 指标与去年同期对比", tag: "BI" },
];

/** 後方互換のため ja をデフォルトとして維持する。新規コードは getSuggestedPrompts を使うこと。 */
export const SUGGESTED_PROMPTS: SuggestedPrompt[] = SUGGESTED_PROMPTS_JA;

/** ロケールに応じたサジェストプロンプト一覧を返す。 */
export function getSuggestedPrompts(locale: Locale): SuggestedPrompt[] {
  return locale === "zh" ? SUGGESTED_PROMPTS_ZH : SUGGESTED_PROMPTS_JA;
}

// モデルの label は製品名のため翻訳しない。tag / desc のみロケール化する。
const MODELS_JA: ModelOption[] = [
  { id: "gpt-5-mini", label: "GPT-5 mini", tag: "推奨", desc: "コスパ最良・高精度" },
  { id: "gpt-5", label: "GPT-5", tag: "高精度", desc: "OpenAI 最上位" },
  { id: "gpt-5-nano", label: "GPT-5 nano", tag: "高速", desc: "最安・高速" },
  { id: "gpt-4.1", label: "GPT-4.1", tag: "", desc: "長文脈・非推論" },
  { id: "deepseek-flash", label: "DeepSeek Flash", tag: "高速", desc: "高速・低コスト" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tag: "高精度", desc: "高性能推論モデル" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tag: "", desc: "汎用・最も賢い" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tag: "高速", desc: "高速・低コスト" },
];

const MODELS_ZH: ModelOption[] = [
  { id: "gpt-5-mini", label: "GPT-5 mini", tag: "推荐", desc: "性价比最优·高精度" },
  { id: "gpt-5", label: "GPT-5", tag: "高精度", desc: "OpenAI 旗舰" },
  { id: "gpt-5-nano", label: "GPT-5 nano", tag: "高速", desc: "最便宜·高速" },
  { id: "gpt-4.1", label: "GPT-4.1", tag: "", desc: "长上下文·非推理" },
  { id: "deepseek-flash", label: "DeepSeek Flash", tag: "高速", desc: "高速·低成本" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tag: "高精度", desc: "高性能推理模型" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tag: "", desc: "通用·最强" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tag: "高速", desc: "高速·低成本" },
];

/** 後方互換のため ja をデフォルトとして維持する。新規コードは getModels を使うこと。 */
export const MODELS: ModelOption[] = MODELS_JA;

/** ロケールに応じたモデル一覧を返す。id / label（製品名）は不変。 */
export function getModels(locale: Locale): ModelOption[] {
  return locale === "zh" ? MODELS_ZH : MODELS_JA;
}

const SCOPE_PRESETS_JA: ScopePreset[] = [
  { id: "all", label: "全社", iconName: "globe", desc: "接続済みの全データソース", sources: ["confluence", "notion", "drive", "slack", "github", "postgres"] },
  { id: "docs", label: "ドキュメント", iconName: "book", desc: "Wiki・ドキュメントのみ", sources: ["confluence", "notion", "drive"] },
  { id: "chat", label: "チャット", iconName: "chat", desc: "Slack・スレッドのみ", sources: ["slack"] },
  { id: "code", label: "コード", iconName: "code", desc: "GitHub・コードベース", sources: ["github"] },
  { id: "data", label: "データ", iconName: "database", desc: "PostgreSQL・データウェアハウス", sources: ["postgres"] },
  { id: "files", label: "添付ファイルのみ", iconName: "paperclip", desc: "このスレッドにアップロードしたファイルだけ", sources: ["uploads"] },
];

const SCOPE_PRESETS_ZH: ScopePreset[] = [
  { id: "all", label: "全公司", iconName: "globe", desc: "已连接的全部数据源", sources: ["confluence", "notion", "drive", "slack", "github", "postgres"] },
  { id: "docs", label: "文档", iconName: "book", desc: "仅 Wiki·文档", sources: ["confluence", "notion", "drive"] },
  { id: "chat", label: "聊天", iconName: "chat", desc: "仅 Slack·会话", sources: ["slack"] },
  { id: "code", label: "代码", iconName: "code", desc: "GitHub·代码库", sources: ["github"] },
  { id: "data", label: "数据", iconName: "database", desc: "PostgreSQL·数据仓库", sources: ["postgres"] },
  { id: "files", label: "仅附件", iconName: "paperclip", desc: "仅本会话上传的文件", sources: ["uploads"] },
];

/** 後方互換のため ja をデフォルトとして維持する。新規コードは getScopePresets を使うこと。 */
export const SCOPE_PRESETS: ScopePreset[] = SCOPE_PRESETS_JA;

/** ロケールに応じたスコープ・プリセット一覧を返す。id / iconName / sources は不変。 */
export function getScopePresets(locale: Locale): ScopePreset[] {
  return locale === "zh" ? SCOPE_PRESETS_ZH : SCOPE_PRESETS_JA;
}

export const ALL_CONNECTORS: SourceConnector[] = [
  { id: "confluence", label: "Confluence", iconName: "book", count: "15,234", color: "#2B579A", darkColor: "#6EA8FF" },
  { id: "notion", label: "Notion", iconName: "doc", count: "8,420", color: "#1F1B16", darkColor: "#F0ECE2" },
  { id: "drive", label: "Google Drive", iconName: "fileDoc", count: "2,108", color: "#1F8A5B", darkColor: "#45D39A" },
  { id: "slack", label: "Slack", iconName: "hash", count: "42 ch", color: "#7A5AE0", darkColor: "#9B7CFF" },
  { id: "github", label: "GitHub", iconName: "github", count: "38 repos", color: "#1F1B16", darkColor: "#F0ECE2" },
  { id: "postgres", label: "PostgreSQL", iconName: "database", count: "warehouse", color: "#2B579A", darkColor: "#6EA8FF" },
];

export const DEFAULT_USER = {
  name: "田中 寛志",
  firstName: "寛志",
  org: "ARag, Inc.",
  initials: "HT",
  email: "hiroshi.tanaka@arag.dev",
};
