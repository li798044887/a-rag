/** Shared domain types for the ARag agentic-RAG workspace. */

import type { IconName } from "@/components/icons";

// ── Sources / citations ─────────────────────────────────────────────────────
export type SourceType = "meeting" | "wiki" | "slack" | "doc";

export interface SourceSection {
  id: string;
  heading: string;
  body: string;
  highlight?: boolean;
  blockType?: string;
  page?: number;
}

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  path: string;
  author: string;
  date: string;
  sections: SourceSection[];
  /** 文書内チャンクの再ランクスコア(0–1)の最大値。未取得なら undefined。 */
  score?: number;
}

/** Maps a citation number ([1], [2]…) to the source + section it opens. */
export type CitationMap = Record<number, { sourceId: string; sectionId: string }>;

// ── Agent tool calls ────────────────────────────────────────────────────────
export type ToolStatus = "pending" | "running" | "done" | "error";

export type ToolName =
  | "rewrite_query"
  | "retrieve"
  | "embed"
  | "vector_search"
  | "bm25_search"
  | "rerank"
  | "expand"
  | "fetch_document"
  | "summarize"
  | "answer"
  | "web_search"
  | "python_sandbox"
  | "sql_query";

export interface RerankHit {
  id: string;
  score: number;
  title: string;
}

export interface ToolCall {
  id: string;
  name: ToolName;
  parentId?: string;
  label: string;
  status: ToolStatus;
  durationMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  summary: string;
}

// ── Threads ─────────────────────────────────────────────────────────────────
export interface ThreadSummary {
  id: string;
  title: string;
  updated: string;
  pinned?: boolean;
  active?: boolean;
}

export interface CompletedThread {
  query: string;
  answerText: string;
  tokens: number;
  durationMs: number;
}

/** 1ターン分（ユーザー質問 + エージェント実行 + 回答）。 */
export interface Turn {
  query: string;
  steps: ToolCall[];
  answer: string;
  streaming: boolean;
  citationMap: CitationMap;
  sourceIds: string[];
  sources: Source[];
  tokens: number;
  durationMs: number;
  status: "running" | "done" | "cancelled" | "error";
  attachments: string[];
  /** 添付の documentId（添付ありターンの retrieve スコープ・再生成再利用に使う。in-memory のみ）。 */
  attachmentDocIds?: string[];
}

// ── Models / prompts / scope ────────────────────────────────────────────────
export interface ModelOption {
  id: string;
  label: string;
  tag: string;
  desc: string;
}

export interface SuggestedPrompt {
  icon: IconName;
  label: string;
  tag: string;
}

export interface ScopePreset {
  id: string;
  label: string;
  iconName: IconName;
  desc: string;
  sources: string[];
}

export interface ScopeValue {
  id: string;
  label: string;
  iconName: IconName;
  desc?: string;
  sources: string[];
}

export interface SourceConnector {
  id: string;
  label: string;
  iconName: IconName;
  count: string;
  color: string;
  darkColor?: string;
}

// ── User / auth ─────────────────────────────────────────────────────────────
export interface AppUser {
  name: string;
  firstName: string;
  org: string;
  initials: string;
  email: string;
}

// ── Uploads ─────────────────────────────────────────────────────────────────
export type UploadStatus = "uploading" | "queued" | "processing" | "ready" | "error" | "skipped";

// rag worker の段階キー（parsing→chunking→embedding→indexing→ready）。
// SSE 進捗で受け取り、段階ステッパーの現在位置に使う。
export type IngestStage = "parsing" | "chunking" | "embedding" | "indexing" | "ready";

export interface StagedFile {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  pages?: number | null;
  chunks?: number;
  error?: string;
  jobId?: string;
  /** アップロード応答で確定する rag 側 documentId（添付スコープ検索に使う）。 */
  documentId?: string;
  /** rag の現在段階キー（SSE 由来）。ステッパー表示に使う。 */
  stage?: IngestStage;
  /** 段階の日本語ラベル（例: 「埋め込み生成」）。SSE の stage_detail。 */
  stageDetail?: string;
  /** フォルダアップロード時の相対パス（キューのグループ表示用、UIのみ）。 */
  relPath?: string;
  /** 処理開始時刻（epoch ms）。所要時間の算出に使う。 */
  startedAt?: number;
  /** 索引化完了までの所要時間（ms）。ready 到達時に確定。 */
  durationMs?: number;
}

// ── Documents (管理) ────────────────────────────────────────────────────────
export interface DocumentSummary {
  id: string;
  filename: string;
  mime: string;
  size: number;
  page_count: number | null;
  status: string;
  created_at: string;
  chunk_count: number;
  latest_job_id: string | null;
  error: string | null;
}

export interface DocumentListResponse {
  items: DocumentSummary[];
  next_cursor: string | null;
  total: number;
}

export interface DocumentPreviewChunk {
  chunk_id: string;
  ordinal: number;
  heading_path: string;
  page_start: number;
  page_end: number;
  block_type: string;
  text: string;
}

export interface DocumentPreview {
  document_id: string;
  document_title: string;
  chunks: DocumentPreviewChunk[];
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: string;
  msg: string;
  kind: ToastKind;
}

// ── Agent behavior config (persisted, sent per chat request) ────────────────
export interface AgentCfg {
  /** エージェントが取れる最大のツール呼出し回数 */
  maxSteps: number;
  /** 同時に走らせるツール数 */
  parallelTools: number;
  /** 回答中の各事実に引用を付けることを強制 */
  requireCitations: boolean;
  /** 未知の場合に「わからない」と返す */
  admitUnknown: boolean;
  /** リランク後に回答へ渡す最終チャンク数 */
  topK: number;
  /** ベクトル/BM25 検索それぞれの候補プール件数（リランク対象） */
  candidateK: number;
}

// ── Tweaks (persisted display preferences) ──────────────────────────────────
export type ToolView = "card" | "timeline" | "log";
export type Density = "compact" | "comfy";
export type CitationStyle = "numbered" | "chip" | "pill";

export interface Tweaks {
  dark: boolean;
  accent: string;
  toolView: ToolView;
  density: Density;
  citationStyle: CitationStyle;
}

// ── Agent SSE stream protocol (server → client) ─────────────────────────────
export type AgentEvent =
  | { type: "step"; step: ToolCall }
  | { type: "answer-start" }
  | { type: "answer-delta"; text: string }
  | {
      type: "done";
      tokens: number;
      durationMs: number;
      citationMap: CitationMap;
      sourceIds: string[];
      sources: Source[];
      threadId: string;
    }
  | { type: "error"; message: string };
