"use client";

import { cn } from "@/lib/utils";
import type { Source } from "@/lib/types";

interface Props {
  tokens: number;
  durationMs: number;
  sources: Source[];
  onCopy: () => void;
  onRegenerate: () => void;
  onOpenSources: () => void;
  sourcesActive: boolean;
  onFeedback: (v: "up" | "down") => void;
  feedback: "up" | "down" | null;
}

const chipCls =
  "inline-flex items-center gap-[5px] rounded-full border-[0.5px] border-divider-strong bg-surface px-2 py-[3px] font-mono text-[11px] text-muted";
const btnCls = "grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-divider hover:text-fg";

export function AnswerFooter({ tokens, durationMs, sources, onCopy, onRegenerate, onOpenSources, sourcesActive, onFeedback, feedback }: Props) {
  return (
    <div className="mt-3.5 flex items-center justify-between gap-2 border-t-[0.5px] border-dashed border-divider-strong pt-3.5 max-md:flex-wrap max-md:gap-y-2">
      <div className="flex flex-wrap gap-1.5">
        <span className={chipCls}>
          <svg viewBox="0 0 16 16" width="11" height="11">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          {(durationMs / 1000).toFixed(1)}s
        </span>
        <span className={chipCls}>
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {tokens >= 1000 ? `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k` : tokens} tokens
        </span>
        <button
          type="button"
          onClick={onOpenSources}
          title="このターンの一次資料を表示"
          className={cn(
            chipCls,
            "cursor-pointer",
            sourcesActive
              ? "border-accent bg-accent-soft text-accent hover:bg-accent/20"
              : "hover:border-divider-strong hover:text-fg"
          )}
        >
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M5 2.75h6.25L13 4.5v7.75H5z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round" />
            <path d="M3 5.25v8h8" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 6.25h3.75M7 8.5h3.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {sources.length} sources
        </button>
      </div>
      <div className="flex gap-0.5 max-md:ml-auto">
        <button className={btnCls} title="コピー" onClick={onCopy}>
          <svg viewBox="0 0 16 16" width="12" height="12">
            <rect x="5" y="3" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M3 11V4.5A1.5 1.5 0 014.5 3H10" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
        <button className={btnCls} title="再生成" onClick={onRegenerate}>
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M13 8a5 5 0 11-1.5-3.5L13 6V3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className={cn(btnCls, feedback === "up" && "text-accent")}
          title="良い回答"
          onClick={() => onFeedback("up")}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill={feedback === "up" ? "currentColor" : "none"}>
            <path d="M3 8h2v6H3zM5 8l3-5c0-1 1.5-1 1.5 0V7h3.5a1 1 0 011 1.3l-1.3 4a1 1 0 01-1 .7H5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className={cn(btnCls, feedback === "down" && "text-[#B83A1F]")}
          title="悪い回答"
          onClick={() => onFeedback("down")}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" style={{ transform: "rotate(180deg)" }} fill={feedback === "down" ? "currentColor" : "none"}>
            <path d="M3 8h2v6H3zM5 8l3-5c0-1 1.5-1 1.5 0V7h3.5a1 1 0 011 1.3l-1.3 4a1 1 0 01-1 .7H5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function CancelledNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border-[0.5px] border-dashed border-divider-strong bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>ユーザーにより実行が停止されました。</span>
      <button className="ml-auto border-0 bg-transparent py-1 text-[12.5px] font-semibold text-accent hover:underline" onClick={onRetry}>
        もう一度実行
      </button>
    </div>
  );
}
