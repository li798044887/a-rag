"use client";

import type { Toast } from "@/lib/types";

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastViewport({ toasts, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col-reverse gap-2 max-md:bottom-[max(82px,calc(env(safe-area-inset-bottom)+70px))] max-md:left-3 max-md:right-3 max-md:translate-x-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto inline-flex min-w-[240px] max-w-[420px] animate-toast-in items-center gap-2.5 rounded-[10px] border-[0.5px] border-divider-strong bg-surface py-2.5 pl-[14px] pr-3 text-[13px] font-medium text-fg shadow-e2 max-md:w-full max-md:min-w-0 max-md:max-w-none"
        >
          <span
            className={
              "shrink-0 " +
              (t.kind === "success" ? "text-accent" : t.kind === "error" ? "text-[#B83A1F]" : "text-muted")
            }
          >
            {t.kind === "success" && (
              <svg viewBox="0 0 16 16" width="14" height="14">
                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
                <path d="M4.5 8.2 7 10.5l4.5-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {t.kind === "info" && (
              <svg viewBox="0 0 16 16" width="14" height="14">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <path d="M8 7v4M8 5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
            {t.kind === "error" && (
              <svg viewBox="0 0 16 16" width="14" height="14">
                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
                <path d="M8 4v5M8 11v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="flex-1">{t.msg}</span>
          <button
            className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
            onClick={() => onDismiss(t.id)}
            aria-label="閉じる"
          >
            <svg viewBox="0 0 12 12" width="10" height="10">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
