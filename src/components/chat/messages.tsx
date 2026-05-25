"use client";

import { CitedText } from "@/components/chat/cited-text";
import type { CitationStyle } from "@/lib/types";

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
