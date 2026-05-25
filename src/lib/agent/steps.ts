/** Client-safe agent helpers (no server/AI-SDK imports). */
import { SAMPLE_TOOL_CALLS } from "@/lib/data";
import type { ToolCall } from "@/lib/types";

/** The pending step list the client renders optimistically before the stream. */
export function buildInitialSteps(query: string): ToolCall[] {
  return SAMPLE_TOOL_CALLS.map((s) =>
    s.name === "rewrite_query"
      ? { ...s, status: "pending" as const, input: { ...s.input, query } }
      : { ...s, status: "pending" as const },
  );
}
