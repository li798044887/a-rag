import type { Locale } from "@/i18n/config";

export interface AgentPrompts {
  /** streamText に渡すシステムプロンプト。 */
  system: string;
  /** 添付ありターンのユーザーメッセージ整形。 */
  buildUserContent: (query: string, attachments: string[], attachmentDocIds: string[]) => string;
  /** retrieve 検索クエリ引数の zod .describe() 文。 */
  retrieveQueryDescribe: string;
  /** fetch_document ref 引数の zod .describe() 文。 */
  fetchRefDescribe: string;
  toolDescriptions: { retrieve: string; fetch_document: string };
  /** トップレベルのツールラベル（UI 表示）。 */
  toolLabels: { retrieve: string; fetch_document: string };
  /** ツール実行中サマリ。 */
  runningSummaries: { retrieve: string; fetch_document: string; default: string };
  /** retrieve サブステージのラベル/サマリ。 */
  stageLabels: Record<"embed" | "vector_search" | "bm25_search" | "rerank" | "expand", string>;
  stageRunning: Record<"embed" | "vector_search" | "bm25_search" | "rerank" | "expand", string>;
  stageDone: {
    embed: string;
    vector_search: (count: number) => string;
    bm25_search: (count: number) => string;
    rerank: (count: number) => string;
    expand: string;
    default: string;
  };
  stageErrorSummary: string;
  stageDefaultRunning: string;
  /** 回答生成ステップ。 */
  answerStep: { label: string; running: string; done: string };
  /** rewrite_query ステップ。 */
  rewriteLabel: string;
  rewriteSummary: (rewritten: string) => string;
  /** ツール meta サマリ。 */
  retrieveMetaSummary: (query: string, count: number) => string;
  fetchMetaSummary: (title: string, count: number) => string;
  fetchUnresolvedSummary: (ref: number) => string;
  toolErrorSummary: string;
  /** ツール結果/回答のフォールバック文。 */
  fallback: {
    retrieveNoHits: string;
    fetchUnresolved: (ref: number) => string;
    fetchEmpty: string;
    genFailed: string;
    noSources: string;
    genUnavailable: string;
    modelUnavailable: string;
  };
}

const JA: AgentPrompts = {
  system:
    "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
    "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
    "回答は提供された一次資料のみに基づき日本語で簡潔に行い、重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付け、" +
    "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。資料に無いことは推測しないでください。",
  buildUserContent: (query, attachments, attachmentDocIds) => {
    if (attachmentDocIds.length && attachments.length) {
      return (
        `ユーザーは次のファイルを添付しました（既に知識ベースへ取り込み済み）: ${attachments.join("、")}。\n` +
        `これらのファイルの内容は retrieve ツールで検索できます。必ず retrieve を使ってファイルの内容を調べてから回答してください。` +
        `「ファイルを直接読めない」などと答えてはいけません。\n\n` +
        `質問: ${query}`
      );
    }
    return query;
  },
  retrieveQueryDescribe: "検索クエリ（会話文脈を解決した自己完結な日本語）",
  fetchRefDescribe: "retrieve 結果の出典番号 [n] の数値（例: 1）",
  toolDescriptions: {
    retrieve:
      "社内ナレッジから関連箇所を検索する。ユーザーの質問に答えるために必要な事実を集めるとき、" +
      "また会話の文脈を踏まえた具体的なクエリで何度でも呼べる。" +
      "各ヒットの先頭に付く [n] が出典番号で、深掘りしたいときはその番号を fetch_document に渡す。",
    fetch_document:
      "retrieve でヒットした文書の周辺本文を取得して深掘りする。" +
      "retrieve 結果に付いた出典番号 [n] の数値だけを ref に渡す（UUID は不要）。",
  },
  toolLabels: { retrieve: "知識ベース検索", fetch_document: "文書取得" },
  runningSummaries: { retrieve: "知識ベースを検索中…", fetch_document: "文書を取得中…", default: "実行中…" },
  stageLabels: {
    embed: "クエリ埋め込み", vector_search: "ベクトル検索", bm25_search: "キーワード検索",
    rerank: "リランキング", expand: "近傍拡張",
  },
  stageRunning: {
    embed: "クエリを埋め込み中…", vector_search: "密ベクトル検索中…", bm25_search: "キーワード検索中…",
    rerank: "再順位付け中…", expand: "近傍チャンクを取得中…",
  },
  stageDone: {
    embed: "クエリを埋め込み",
    vector_search: (c) => `密ベクトル ${c} 件`,
    bm25_search: (c) => `BM25 ${c} 件`,
    rerank: (c) => `${c} 件に再順位付け`,
    expand: "近傍拡張",
    default: "完了",
  },
  stageErrorSummary: "段階に失敗",
  stageDefaultRunning: "実行中…",
  answerStep: { label: "回答生成", running: "回答を生成中…", done: "回答を生成" },
  rewriteLabel: "クエリ正規化",
  rewriteSummary: (r) => `「${r}」に書き換え`,
  retrieveMetaSummary: (q, c) => `「${q}」→ ${c} 件`,
  fetchMetaSummary: (t, c) => `${t} → ${c} 段`,
  fetchUnresolvedSummary: (ref) => `出典 [${ref}] は未取得`,
  toolErrorSummary: "ツール実行に失敗",
  fallback: {
    retrieveNoHits: "該当する資料は見つかりませんでした。",
    fetchUnresolved: (ref) => `出典 [${ref}] はまだ取得していません。先に retrieve を実行し、結果に付いた番号を指定してください。`,
    fetchEmpty: "文書の本文が取得できませんでした。",
    genFailed: "回答の生成に失敗しました。時間をおいて再度お試しください。",
    noSources: "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。",
    genUnavailable: "回答を生成できませんでした。時間をおいて再度お試しください。",
    modelUnavailable: "モデルが利用できません。API キーの設定を確認してください。",
  },
};

const ZH: AgentPrompts = {
  system:
    "你是企业内部知识检索助手。请在需要时调用 retrieve / fetch_document 工具，" +
    "并结合对话上下文构造自包含的中文检索查询。" +
    "回答必须仅依据工具返回的一手资料，用简洁的中文作答；" +
    "对每条关键事实务必标注工具结果中对应的 [1] [2] 出处编号；" +
    "使用 Markdown 结构化（**加粗**小标题、- 列表）。" +
    "资料中没有依据的内容不要臆测或编造。",
  buildUserContent: (query, attachments, attachmentDocIds) => {
    if (attachmentDocIds.length && attachments.length) {
      return (
        `用户上传了以下文件（已存入知识库）：${attachments.join("、")}。\n` +
        `这些文件的内容可以通过 retrieve 工具检索。请务必先用 retrieve 查阅文件内容再作答，` +
        `不要回答“无法直接读取文件”之类的话。\n\n` +
        `问题：${query}`
      );
    }
    return query;
  },
  retrieveQueryDescribe: "检索查询（已结合对话上下文、自包含的中文查询）",
  fetchRefDescribe: "retrieve 结果中出处编号 [n] 的数字（例如：1）",
  toolDescriptions: {
    retrieve:
      "从企业内部知识库检索相关片段。当需要收集回答用户问题所需的事实时调用；" +
      "可结合对话上下文用具体查询多次调用。" +
      "每条命中结果开头的 [n] 即出处编号，需深入查阅时把该编号传给 fetch_document。",
    fetch_document:
      "获取 retrieve 命中文档的上下文正文以深入查阅。" +
      "只把 retrieve 结果中的出处编号 [n] 的数字传给 ref（无需 UUID）。",
  },
  toolLabels: { retrieve: "知识库检索", fetch_document: "文档获取" },
  runningSummaries: { retrieve: "正在检索知识库…", fetch_document: "正在获取文档…", default: "执行中…" },
  stageLabels: {
    embed: "查询向量化", vector_search: "向量检索", bm25_search: "关键词检索",
    rerank: "重排序", expand: "邻近扩展",
  },
  stageRunning: {
    embed: "正在向量化查询…", vector_search: "正在稠密向量检索…", bm25_search: "正在关键词检索…",
    rerank: "正在重排序…", expand: "正在获取邻近片段…",
  },
  stageDone: {
    embed: "查询向量化完成",
    vector_search: (c) => `稠密向量 ${c} 条`,
    bm25_search: (c) => `BM25 ${c} 条`,
    rerank: (c) => `重排序至 ${c} 条`,
    expand: "邻近扩展",
    default: "完成",
  },
  stageErrorSummary: "阶段失败",
  stageDefaultRunning: "执行中…",
  answerStep: { label: "生成回答", running: "正在生成回答…", done: "回答已生成" },
  rewriteLabel: "查询规范化",
  rewriteSummary: (r) => `已改写为「${r}」`,
  retrieveMetaSummary: (q, c) => `「${q}」→ ${c} 条`,
  fetchMetaSummary: (t, c) => `${t} → ${c} 段`,
  fetchUnresolvedSummary: (ref) => `出处 [${ref}] 尚未获取`,
  toolErrorSummary: "工具执行失败",
  fallback: {
    retrieveNoHits: "未找到相关资料。",
    fetchUnresolved: (ref) => `出处 [${ref}] 尚未获取。请先执行 retrieve，再指定结果中给出的编号。`,
    fetchEmpty: "未能获取文档正文。",
    genFailed: "生成回答失败，请稍后重试。",
    noSources: "未找到相关资料。请换一种说法提问，或上传相关文件。",
    genUnavailable: "未能生成回答，请稍后重试。",
    modelUnavailable: "模型不可用，请检查 API 密钥配置。",
  },
};

const PROMPTS: Record<Locale, AgentPrompts> = { zh: ZH, ja: JA };

export function getAgentPrompts(locale: Locale): AgentPrompts {
  return PROMPTS[locale];
}
