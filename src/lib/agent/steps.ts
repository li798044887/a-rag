/** Client-safe agent helpers (no server/AI-SDK imports). */
import { SAMPLE_TOOL_CALLS } from "@/lib/data";
import type { ToolCall } from "@/lib/types";

/** The pending step list the client renders optimistically before the stream.
 *
 * SAMPLE_TOOL_CALLS からは「ステップ定義」（id / name / label）だけを引き継ぎ、
 * デモ用の input・output（例: "製品MTG 議事録 — 2026-04-12"）・summary・durationMs は
 * 持ち越さない。これらは実行時にストリームの step イベントで実値が入る。
 * こうしないと送信直後にデモ内容が一瞬表示され、実データで上書きされて見える。 */
export function buildInitialSteps(query: string): ToolCall[] {
  return SAMPLE_TOOL_CALLS.map((s) => ({
    id: s.id,
    name: s.name,
    label: s.label,
    status: "pending" as const,
    durationMs: 0,
    input: s.name === "rewrite_query" ? { query } : {},
    output: null,
    summary: "",
  }));
}
