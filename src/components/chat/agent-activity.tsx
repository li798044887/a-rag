"use client";

import { useState } from "react";
import { ToolSteps } from "@/components/chat/tool-steps";
import { cn, formatMs } from "@/lib/utils";
import type { ToolCall, ToolView } from "@/lib/types";

/** ターンのツール活動。実行中は展開、完了後は1行サマリへ畳む。 */
export function AgentActivity({
  steps, variant, running, expandedMap, onToggleStep,
}: {
  steps: ToolCall[];
  variant: ToolView;
  running: boolean;
  expandedMap: Record<string, boolean>;
  onToggleStep: (id: string) => void;
}) {
  // 実行中は既定で開く。完了したら畳む（ユーザーが開閉した値を優先）。
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? running;

  if (steps.length === 0) return null;

  const totalMs = steps.reduce((a, s) => a + (s.durationMs || 0), 0);
  const current = steps.find((s) => s.status === "running");

  return (
    <div className="overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface-2">
      <button
        onClick={() => setOpen(!isOpen)}
        className="flex w-full items-center justify-between border-0 bg-transparent px-3.5 py-2.5 text-left hover:bg-surface max-md:px-3"
      >
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-fg">
          {running ? (
            <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          )}
          {running ? (current?.summary ?? "エージェント実行中…") : "エージェント実行"}
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
          {steps.length} ステップ · {formatMs(totalMs)}
          <span className={cn("transition-transform", isOpen && "rotate-180")}>
            <svg viewBox="0 0 16 16" width="11" height="11">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="border-t-[0.5px] border-divider">
          <ToolSteps steps={steps} variant={variant} expandedMap={expandedMap} onToggleStep={onToggleStep} />
        </div>
      )}
    </div>
  );
}
