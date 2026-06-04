import type { Locale } from "@/i18n/config";

export interface AgentPrompts {
  /** システムプロンプトの構成断片（buildSystemPrompt が cfg に応じて結合する）。 */
  systemIntro: string;
  temporalContext: (context: TemporalPromptContext) => string;
  citationRequired: string;
  citationOptional: string;
  unknownAdmit: string;
  unknownFill: string;
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
  /** grade（関連度判定）ノード。 */
  grade: {
    label: string;
    running: string;
    /** 曖昧帯チャンクの関連性を判定する LLM system。 */
    system: string;
    done: (kept: number, total: number) => string;
    /** 関連不足で再検索する際のサマリ。 */
    retry: string;
    /** 再検索 retrieve の短い表示ラベル。 */
    retryLabel: string;
  };
  /** 再検索時のクエリ改善 LLM system。 */
  queryRewrite: { system: string };
  /** verify（根拠検証）ノード。 */
  verify: {
    label: string;
    running: string;
    system: string;
    done: (unsupported: number, checkableClaims?: number) => string;
  };
  /** revise（訂正再生成）ノード。 */
  revise: {
    label: string;
    running: string;
    system: string;
    done: string;
  };
  /** ツール結果/回答のフォールバック文。 */
  fallback: {
    retrieveNoHits: string;
    fetchUnresolved: (ref: number) => string;
    fetchEmpty: string;
    genFailed: string;
    genFailedWithDetail: (detail: string) => string;
    noSources: string;
    genUnavailable: string;
    modelUnavailable: string;
  };
}

export interface TemporalPromptContext {
  nowDate: string;
  nowTime: string;
  today: string;
  yesterday: string;
  tomorrow: string;
  timeZone: string;
}

const JA: AgentPrompts = {
  systemIntro:
    "あなたは社内ナレッジ検索アシスタントです。必要に応じて retrieve / fetch_document ツールを使い、" +
    "会話の文脈を踏まえて自己完結した検索クエリを組み立ててください。" +
    "ユーザーの入力や資料が他言語でも、必ず日本語で回答してください。" +
    "回答は提供された一次資料に基づき簡潔に行い、" +
    "Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。",
  temporalContext: (context) =>
    `現在日時: ${context.nowDate} ${context.nowTime}（タイムゾーン: ${context.timeZone}）。` +
    `今日=${context.today}、昨日=${context.yesterday}、明日=${context.tomorrow}。` +
    "ユーザーが「今日」「昨日」「明日」「先週」「今月」などの相対日付で質問した場合は、" +
    "この現在日時を基準に具体的な日付または日付範囲へ解決し、retrieve の検索クエリにも具体日付を含めてください。" +
    "相対語だけを検索語にしないでください。",
  citationRequired: "重要な事実には必ずツール結果に付いた [1] [2] の出典番号を付けてください。",
  citationOptional: "可能であればツール結果に付いた [1] [2] の出典番号を付けてください（必須ではありません）。",
  unknownAdmit: "資料に無いことは推測せず、判断できない場合は「わからない」と明確に答えてください。",
  unknownFill: "資料に直接の記載が無い場合は、一般的な知識で補って回答してもかまいません。",
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
  grade: {
    label: "関連度判定",
    running: "取得結果の関連度を判定中…",
    system:
      "あなたは検索結果の関連性を判定する審査器です。ユーザーの質問に対し、各候補チャンクが回答の根拠になり得るかを判定し、" +
      "関連すると判断したチャンクの chunkId のみを返してください。" +
      "質問への完全な答えでなくても、対象設備・症状・図中の部品・除外条件・対応手順などの一部を直接支えるなら関連とみなしてください。" +
      "単語が似ているだけで論点が違うものは含めないでください。",
    done: (k, t) => `${t} 件中 ${k} 件が関連`,
    retry: "関連資料が不足のため再検索",
    retryLabel: "再検索",
  },
  queryRewrite: {
    system:
      "あなたは検索クエリを改善する補助器です。直前の検索では十分な関連資料が得られませんでした。" +
      "質問の意図を保ちつつ、語彙や言い回しを変えた自己完結な検索クエリを1つだけ返してください。",
  },
  verify: {
    label: "根拠検証",
    running: "回答の根拠を検証中…",
    system:
      "あなたは事実検証器です。回答中の各主張を分解し、主張ごとに citedNums と verdict を返してください。" +
      "verdict は supported / unsupported / not_a_claim のいずれかです。" +
      "引用番号 [n] が付いた主張は、その番号の出典だけで直接裏付けられる場合のみ supported としてください。" +
      "別の出典に根拠があっても、付与された引用番号が支えていなければ unsupported です。" +
      "引用が無い重要な事実、出典に明記されていない推測、候補・除外・交換対象などの関係が曖昧な主張は unsupported とみなします。" +
      "ただし「資料から判断できない」「確認できない」等の不足表明や一般的な確認提案は未裏付け主張に含めないでください。" +
      "また、質問対象や論点を表すだけの名詞句（例:「どのレベルにあるかの具体的な情報」）は主張ではないため列挙しないでください。",
    done: (n, c) => (n > 0 ? `未裏付けの主張 ${n} 件` : c === 0 ? "検証対象の主張なし" : "全主張が出典で裏付け済み"),
  },
  revise: {
    label: "回答の訂正",
    running: "未裏付け箇所を訂正中…",
    system:
      "あなたは回答を訂正する編集器です。元の質問に直接答える形を保ち、指摘された未裏付けの主張を、" +
      "与えられた出典のみを根拠に書き直すか、根拠が無ければ削除してください。" +
      "出典に無い情報を新たに追加しないでください。出典番号 [n] は、その番号の出典が直前の主張を支える場合のみ残してください。" +
      "ユーザーの入力や資料が他言語でも、必ず日本語で回答してください。訂正後の回答本文だけを返してください。",
    done: "未裏付け箇所を訂正",
  },
  fallback: {
    retrieveNoHits: "該当する資料は見つかりませんでした。",
    fetchUnresolved: (ref) => `出典 [${ref}] はまだ取得していません。先に retrieve を実行し、結果に付いた番号を指定してください。`,
    fetchEmpty: "文書の本文が取得できませんでした。",
    genFailed: "回答の生成に失敗しました。時間をおいて再度お試しください。",
    genFailedWithDetail: (detail) => `回答の生成に失敗しました。時間をおいて再度お試しください。\n\nエラー詳細: ${detail}`,
    noSources: "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。",
    genUnavailable: "回答を生成できませんでした。時間をおいて再度お試しください。",
    modelUnavailable: "モデルが利用できません。API キーの設定を確認してください。",
  },
};

const ZH: AgentPrompts = {
  systemIntro:
    "你是企业内部知识检索助手。请在需要时调用 retrieve / fetch_document 工具，" +
    "并结合对话上下文构造自包含的中文检索查询。" +
    "无论用户输入或资料使用什么语言，必须始终使用中文回答。" +
    "回答应简洁，并以 Markdown 结构化（**加粗**小标题、- 列表）。",
  temporalContext: (context) =>
    `当前日期时间：${context.nowDate} ${context.nowTime}（时区：${context.timeZone}）。` +
    `今天=${context.today}，昨天=${context.yesterday}，明天=${context.tomorrow}。` +
    "当用户用“今天”“昨天”“明天”“上周”“本月”等相对日期提问时，" +
    "必须先按该日期时间换算为具体日期或日期范围，并在 retrieve 检索查询中包含具体日期。" +
    "不要只把相对词作为检索词。",
  citationRequired: "对每条关键事实务必标注工具结果中对应的 [1] [2] 出处编号。",
  citationOptional: "如有可能，请为关键事实标注工具结果中的 [1] [2] 出处编号（非强制）。",
  unknownAdmit: "回答须仅依据检索到的一手资料；资料中没有依据的内容不要臆测或编造，无法判断时请明确回答“无法确定”。",
  unknownFill: "若检索到的资料中没有直接记载，可结合通用知识进行补充回答。",
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
  grade: {
    label: "相关性判定",
    running: "正在判定检索结果的相关性…",
    system:
      "你是检索结果相关性审查器。针对用户问题，判断每个候选片段是否能作为回答依据，" +
      "只返回你判定为相关的片段 chunkId。" +
      "即使片段不能完整回答问题，只要能直接支撑对象设备、症状、图中部件、排除条件或处理步骤的一部分，也应视为相关。" +
      "仅词面相似但论点不同的片段不要包含。",
    done: (k, t) => `${t} 条中 ${k} 条相关`,
    retry: "相关资料不足，重新检索",
    retryLabel: "重新检索",
  },
  queryRewrite: {
    system:
      "你是检索查询改写助手。上一次检索未获得足够相关资料。" +
      "请在保持问题意图的前提下，更换措辞与表达，只返回一个自包含的检索查询。",
  },
  verify: {
    label: "依据校验",
    running: "正在校验回答依据…",
    system:
      "你是事实校验器。请拆解回答中的每条主张，并为每条主张返回 citedNums 与 verdict。" +
      "verdict 只能是 supported / unsupported / not_a_claim。" +
      "带有出处编号 [n] 的主张，只有在这些编号对应的出处本身能直接支撑该主张时才算 supported。" +
      "即使其他出处能支撑，如果标注的出处编号不能支撑，也应判为 unsupported。" +
      "没有出处编号的重要事实、出处中未明确记载的推断、候选/排除/更换对象等关系不清的主张，都视为 unsupported。" +
      "但“无法根据资料判断”“无法确认”等资料不足说明，以及一般性的查询/参考建议，不要列为无依据主张。" +
      "另外，只表示问题对象或主题的名词短语（如“企业当前收入在行业中的水平”）不是主张，不要列出。",
    done: (n, c) => (n > 0 ? `无依据主张 ${n} 条` : c === 0 ? "无可校验主张" : "全部主张均有出处支撑"),
  },
  revise: {
    label: "修订回答",
    running: "正在修订无依据内容…",
    system:
      "你是回答修订编辑器。请保持直接回答原问题，将被指出的无依据主张仅依据给定出处重写，若无依据则删除。" +
      "不要新增出处中没有的信息。只有当出处编号 [n] 对应的出处能支撑紧邻主张时，才保留该编号。" +
      "无论用户输入或资料使用什么语言，必须始终使用中文回答。只返回修订后的回答正文。",
    done: "已修订无依据内容",
  },
  fallback: {
    retrieveNoHits: "未找到相关资料。",
    fetchUnresolved: (ref) => `出处 [${ref}] 尚未获取。请先执行 retrieve，再指定结果中给出的编号。`,
    fetchEmpty: "未能获取文档正文。",
    genFailed: "生成回答失败，请稍后重试。",
    genFailedWithDetail: (detail) => `生成回答失败，请稍后重试。\n\n错误详情：${detail}`,
    noSources: "未找到相关资料。请换一种说法提问，或上传相关文件。",
    genUnavailable: "未能生成回答，请稍后重试。",
    modelUnavailable: "模型不可用，请检查 API 密钥配置。",
  },
};

const PROMPTS: Record<Locale, AgentPrompts> = { zh: ZH, ja: JA };

export function getAgentPrompts(locale: Locale): AgentPrompts {
  return PROMPTS[locale];
}
