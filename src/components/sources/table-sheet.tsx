"use client";

import { useEffect } from "react";

/** 表を全画面で広く閲覧するためのモーダルシート。Esc / 背景タップ / ✕ で閉じる。 */
export function TableSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="表の全画面表示"
      onClick={onClose}
      className="fixed inset-0 z-[120] flex animate-overlay-in flex-col bg-[rgba(20,18,15,0.45)] p-4 backdrop-blur-[4px] motion-reduce:animate-none max-md:p-0"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 animate-pop-in flex-col overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface shadow-e3 motion-reduce:animate-none max-md:rounded-none"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-divider px-4">
          <span className="text-[13px] font-semibold text-fg">表</span>
          <button
            type="button"
            onClick={onClose}
            title="閉じる"
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-divider hover:text-fg"
          >
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
