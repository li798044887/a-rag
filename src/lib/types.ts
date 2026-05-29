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
export type UploadStatus = "uploading" | "processing" | "ready" | "error";

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
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: string;
  msg: string;
  kind: ToastKind;
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
