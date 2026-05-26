/** Server-side agent orchestrator (real backend).
 *
 * rewrite_query は Haiku、検索は rag /retrieve（hybrid+rerank+近傍拡張）、
 * summarize は Sonnet ストリーミング。各ステップを AgentEvent として配信する。 */

import { generateText, streamText } from "ai";
import { retrieveChunks, type RetrievedChunk } from "@/lib/agent/retrieve-client";
import { resolveModels, DEFAULT_MODEL_ID } from "@/lib/agent/models";
import { buildInitialSteps } from "@/lib/agent/steps";
import type { AgentEvent, CitationMap, Source, ToolCall } from "@/lib/types";

export interface RunInput {
  query: string;
  ownerUserId: string;
  threadId: string;
  attachments?: string[];
  /** UI（設定 > モデル）で選択された model id。未指定時は既定モデル。 */
  modelId?: string;
}

export async function* runAgent({ query, ownerUserId, threadId, modelId }: RunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const steps = buildInitialSteps(query);
  const byName = (name: string) => steps.find((s) => s.name === name)!;

  // 選択モデルを解決。キー未設定なら ok:false（reason を summarize で案内）。
  const resolution = resolveModels(modelId);

  // runningSummary: 実行中に running カードへ出す「現在この段階」の文言。
  // 逐次表示（client は step イベント到着順にカードを追加）で現在地を示すために使う。
  async function* runStep(step: ToolCall, runningSummary: string, work: () => Promise<Partial<ToolCall>>): AsyncGenerator<AgentEvent> {
    yield { type: "step", step: { ...step, status: "running", summary: runningSummary } };
    const t0 = Date.now();
    const patch = await work();
    // 実測の所要時間で上書き（scaffold のデモ値を残さない）。
    const durationMs = patch.durationMs ?? Date.now() - t0;
    Object.assign(step, patch, { status: "done" as const, durationMs });
    yield { type: "step", step };
  }

  // 1) rewrite_query（選択モデルプロバイダの安価モデル。キー無しなら原文のまま）
  let rewritten = query;
  for await (const e of runStep(byName("rewrite_query"), "クエリを正規化中…", async () => {
    if (resolution.ok) {
      try {
        const { text } = await generateText({
          model: resolution.models.rewrite,
          system: "検索意図を保ちつつ、日本語の検索クエリに簡潔に書き換えてください。説明や引用符は不要、クエリ本文のみ返答。",
          prompt: query,
        });
        rewritten = text.trim() || query;
      } catch {
        rewritten = query;
      }
    }
    return { input: { query }, output: { rewritten }, summary: `「${rewritten}」に書き換え` };
  })) yield e;

  // 2) retrieve（rag /retrieve が dense/sparse/rerank/近傍拡張を1ホップで実行）。
  //    重い実待ちは vector_search ステップの内側で行い、その間 running カードに
  //    「密ベクトル検索を実行中…」を出す（逐次表示で現在地を示す）。
  //    bm25_search / rerank / fetch_document は同じ1回の検索結果の内訳で、
  //    取得済みデータから即座に確定するため後続で瞬時に done になる。
  const topK = 6;
  let chunks: RetrievedChunk[] = [];
  let retrieveError = false;

  for await (const e of runStep(byName("vector_search"), "密ベクトル検索を実行中…", async () => {
    try {
      chunks = await retrieveChunks({ query, rewritten, ownerUserId, topK });
    } catch {
      retrieveError = true;
    }
    return {
      input: { query: rewritten, top_k: topK, backend: "qdrant", mode: "dense", collection: "arag_chunks" },
      output: { backend: "qdrant", mode: "dense", hits: chunks.length },
      summary: "密ベクトル検索を実行",
    };
  })) yield e;
  for await (const e of runStep(byName("bm25_search"), "スパース(BM25)検索を実行中…", async () =>
    ({
      input: { query: rewritten, backend: "qdrant", mode: "sparse" },
      output: { backend: "qdrant", mode: "sparse", hits: chunks.length },
      summary: "スパース(BM25)検索を実行",
    }))) yield e;
  for await (const e of runStep(byName("rerank"), "再順位付け中…", async () => ({
    input: { model: "bge-reranker-v2-m3", top_n: topK },
    // UI（rerank カード）は output.selected を RerankHit[] として描画する。
    output: {
      kept: chunks.length,
      selected: chunks.map((c) => ({ id: c.chunkId, score: c.score, title: c.documentTitle })),
    },
    summary: `${chunks.length} 件を再順位付け`,
  }))) yield e;
  const documentIds = [...new Set(chunks.map((c) => c.documentId))];
  const docCount = documentIds.length;
  for await (const e of runStep(byName("fetch_document"), "文書を取得中…", async () =>
    ({
      input: { document_ids: documentIds },
      output: { documents: docCount, chunks: chunks.length },
      summary: `${docCount} 件の文書から文脈取得`,
    }))) yield e;

  // 3) sources / citationMap を構築
  const sources = sourcesFromChunks(chunks);
  const citationMap: CitationMap = {};
  chunks.forEach((c, i) => { citationMap[i + 1] = { sourceId: c.documentId, sectionId: c.chunkId }; });
  const sourceIds = sources.map((s) => s.id);

  // 4) summarize (streaming)
  const summarize = byName("summarize");
  summarize.input = { model: modelId ?? DEFAULT_MODEL_ID };
  const summarizeStart = Date.now();
  yield { type: "step", step: { ...summarize, status: "running", summary: "回答を生成中…" } };
  yield { type: "answer-start" };

  let answer = "";
  if (retrieveError) {
    answer = "検索バックエンドに接続できませんでした。時間をおいて再度お試しください。";
    yield { type: "answer-delta", text: answer };
  } else if (chunks.length === 0) {
    answer = "該当する資料が見つかりませんでした。別の言い回しで質問するか、関連ファイルをアップロードしてください。";
    yield { type: "answer-delta", text: answer };
  } else if (!resolution.ok) {
    // 検索・引用（右パネルの一次資料）は機能するが、回答生成には選択モデルのキーが必要。
    answer = resolution.reason;
    yield { type: "answer-delta", text: answer };
  } else {
    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.documentTitle} — ${c.headingPath}\n${c.expandedText || c.text}`)
      .join("\n\n");
    const result = streamText({
      model: resolution.models.chat,
      system:
        "あなたは社内ナレッジ検索アシスタントです。提供された一次資料のみに基づき日本語で簡潔に回答してください。" +
        "重要な事実には必ず [1] [2] のように出典番号を付け、Markdown の見出し(**太字**)と箇条書き(-)で構造化してください。",
      prompt: `一次資料:\n${context}\n\n質問: ${query}`,
    });
    try {
      for await (const delta of result.textStream) {
        answer += delta;
        yield { type: "answer-delta", text: delta };
      }
    } catch {
      // 生成が途中で失敗しても summarize 完了と done イベントへ合流させる。
      // 既に一部ストリーム済みなら二重表示を避け、未出力時のみ案内を出す。
      if (!answer) {
        answer = "回答の生成に失敗しました。時間をおいて再度お試しください。";
        yield { type: "answer-delta", text: answer };
      }
    }
  }

  Object.assign(summarize, { status: "done" as const, summary: "回答を生成", durationMs: Date.now() - summarizeStart });
  yield { type: "step", step: summarize };

  const tokens = Math.max(1, Math.round(answer.length / 1.8));
  yield {
    type: "done",
    tokens,
    durationMs: Date.now() - started,
    citationMap,
    sourceIds,
    sources,
    threadId,
  };
}

function sourcesFromChunks(chunks: RetrievedChunk[]): Source[] {
  const byDoc = new Map<string, Source>();
  for (const c of chunks) {
    let src = byDoc.get(c.documentId);
    if (!src) {
      src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
              author: "", date: "", sections: [] };
      byDoc.set(c.documentId, src);
    }
    if (!src.sections.some((s) => s.id === c.chunkId)) {
      src.sections.push({ id: c.chunkId, heading: c.headingPath, body: c.text, highlight: true });
    }
  }
  return [...byDoc.values()];
}
