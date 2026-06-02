"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/context";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useT();
  // デフォルトラベルを辞書から取得（呼び出し元が明示的に渡した場合はそちらを優先）。
  const resolvedConfirmLabel = confirmLabel ?? t.modals.confirmDefaultLabel;
  const resolvedCancelLabel = cancelLabel ?? t.modals.cancelDefaultLabel;

  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 次のフレームで autofocus（モーダル DOM 確定後）。
    const id = window.setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.45)] p-6 backdrop-blur-[4px] motion-reduce:animate-none max-md:items-end max-md:p-0"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby={description ? "confirm-modal-desc" : undefined}
        onClick={(e) => e.stopPropagation()}
        className="flex w-[400px] max-w-full animate-pop-in flex-col gap-4 rounded-[16px] border-[0.5px] border-divider-strong bg-surface p-[22px_22px_18px] shadow-e3 motion-reduce:animate-none max-md:w-full max-md:rounded-[18px_18px_0_0] max-md:p-[18px_18px_max(18px,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-2">
          <h3
            id="confirm-modal-title"
            className="m-0 text-[16px] font-bold tracking-[-0.01em] text-fg"
          >
            {title}
          </h3>
          {description && (
            <p
              id="confirm-modal-desc"
              className="m-0 whitespace-pre-line text-[13px] leading-[1.55] text-muted"
            >
              {description}
            </p>
          )}
        </div>
        <div className="mt-1 flex justify-end gap-2 max-md:[&>*]:flex-1">
          <button
            type="button"
            className="h-9 rounded-[9px] border border-divider-strong bg-transparent px-3.5 text-[13px] font-medium text-fg hover:bg-surface-2"
            onClick={onCancel}
          >
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={cn(
              "h-9 rounded-[9px] border-0 px-4 text-[13px] font-semibold text-white hover:brightness-105",
              tone === "danger"
                ? "bg-[#B83A1F] shadow-[0_1px_3px_rgba(184,58,31,0.4)]"
                : "bg-accent shadow-[0_1px_3px_var(--accent-glow)]",
            )}
            onClick={onConfirm}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
