"use client";

import { CitedText } from "@/components/chat/cited-text";
import { AgentActivity } from "@/components/chat/agent-activity";
import { AnswerFooter, CancelledNotice } from "@/components/chat/answer-footer";
import { UserAttachments } from "@/components/uploads/uploads";
import type { CitationStyle, StagedFile, Turn, ToolView } from "@/lib/types";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%] rounded-[16px_16px_4px_16px] bg-bubble-user px-4 py-3 text-[14.5px] leading-[1.55] text-fg [overflow-wrap:anywhere] max-md:max-w-[88%] max-md:rounded-[14px_14px_4px_14px] max-md:px-3.5 max-md:py-[11px] max-md:text-[14px]">
        {text}
      </div>
    </div>
  );
}

export function AssistantMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 max-md:gap-2.5">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-white shadow-[0_1px_3px_var(--accent-glow)] max-md:h-[26px] max-md:w-[26px]">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 max-md:gap-3">{children}</div>
    </div>
  );
}

/** Streaming answer: cited text + a blinking caret while tokens arrive. */
export function StreamingAnswer({
  text,
  streaming,
  onCite,
  citationStyle,
}: {
  text: string;
  streaming: boolean;
  onCite: (n: number) => void;
  citationStyle: CitationStyle;
}) {
  return (
    <div className="text-[14.5px] text-fg-2">
      <CitedText text={text} onCite={onCite} citationStyle={citationStyle} />
      {streaming && (
        <span className="ml-px inline-block h-4 w-2 animate-blink bg-accent align-[-3px]" />
      )}
    </div>
  );
}

export function StaticAnswer({
  text,
  onCite,
  citationStyle,
}: {
  text: string;
  onCite: (n: number) => void;
  citationStyle: CitationStyle;
}) {
  return (
    <div className="text-[14.5px] text-fg-2">
      <CitedText text={text} onCite={onCite} citationStyle={citationStyle} />
    </div>
  );
}

export function Transcript({
  turns, toolView, expandedSteps, onToggleStep, onCite, citationStyle,
  onCopy, onRegenerate, onFeedback, feedback, liveAttachments, isLiveLastTurn,
}: {
  turns: Turn[];
  toolView: ToolView;
  expandedSteps: Record<string, boolean>;
  onToggleStep: (id: string) => void;
  // どのターンの引用かを特定するため turn index を渡す。
  onCite: (n: number, turnIdx: number) => void;
  citationStyle: CitationStyle;
  onCopy: () => void;
  onRegenerate: () => void;
  onFeedback: (v: "up" | "down") => void;
  feedback: "up" | "down" | null;
  liveAttachments: StagedFile[];
  isLiveLastTurn: boolean;
}) {
  return (
    <>
      {turns.map((turn, idx) => {
        const isLast = idx === turns.length - 1;
        const running = turn.status === "running";
        return (
          <div key={idx} data-turn={idx} className="flex flex-col gap-6 max-md:gap-[18px]">
            <UserMessage text={turn.query} />
            <AssistantMessage>
              {isLast && isLiveLastTurn && liveAttachments.length > 0 && <UserAttachments files={liveAttachments} />}
              {running && turn.steps.length === 0 && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
                  考え中…
                </div>
              )}
              <AgentActivity
                steps={turn.steps}
                variant={toolView}
                running={running}
                expandedMap={expandedSteps}
                onToggleStep={onToggleStep}
              />
              {turn.status === "cancelled" ? (
                <CancelledNotice onRetry={onRegenerate} />
              ) : (
                (turn.answer.length > 0 || turn.streaming) && (
                  <StreamingAnswer text={turn.answer} streaming={turn.streaming} onCite={(n) => onCite(n, idx)} citationStyle={citationStyle} />
                )
              )}
              {turn.status === "done" && (
                <AnswerFooter
                  tokens={turn.tokens} durationMs={turn.durationMs} sources={turn.sources}
                  onCopy={onCopy} onRegenerate={onRegenerate} onFeedback={onFeedback} feedback={feedback}
                />
              )}
            </AssistantMessage>
          </div>
        );
      })}
    </>
  );
}
