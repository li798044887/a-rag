"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ScopePicker } from "@/components/chat/scope-picker";
import { AttachmentTray } from "@/components/uploads/uploads";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ModelOption, ScopeValue, StagedFile } from "@/lib/types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  model: ModelOption;
  onChangeModel: () => void;
  running: boolean;
  attachments: StagedFile[];
  onAttachFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  scope: ScopeValue;
  onChangeScope: (s: ScopeValue) => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  model,
  onChangeModel,
  running,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  scope,
  onChangeScope,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLButtonElement>(null);
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, [value]);

  const canSubmit = !!(value.trim() || attachments.length);
  const toolBtn = "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-transparent px-2 text-[12px] font-medium text-muted hover:bg-divider hover:text-fg max-md:h-8";

  return (
    <form
      className="mx-auto w-full max-w-[1020px] px-8 pb-[18px] pt-3.5 max-md:min-w-0 max-md:px-3 max-md:pb-[max(12px,env(safe-area-inset-bottom))] max-md:pt-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!running && canSubmit) onSubmit();
      }}
    >
      <div
        className={cn(
          "rounded-[16px] border border-divider-strong bg-surface shadow-e2 transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-2)] max-md:rounded-[14px]",
        )}
      >
        <AttachmentTray files={attachments} onRemove={onRemoveAttachment} />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          className="hidden"
          onChange={(e) => {
            onAttachFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={running}
          onChange={(e) => onChange(e.target.value)}
          placeholder={running ? "エージェントが実行中です…" : "質問するか、ファイルをドロップして訪ねてください…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !running) {
              e.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          className={cn(
            "max-h-[180px] min-h-[24px] w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-[1.5] text-fg outline-none placeholder:text-muted-2 max-md:px-3.5 max-md:text-[16px]",
            running && "text-muted",
          )}
        />
        <div className="flex items-center gap-1 px-2 pb-2 pt-1 max-md:gap-0.5 max-md:px-1.5">
          <button type="button" className={toolBtn} title="ファイルを添付 (PDF/Word/Excelなど)" disabled={running} onClick={() => fileRef.current?.click()}>
            <Icon name="paperclip" size={13} />
          </button>
          <button
            ref={scopeRef}
            type="button"
            className={cn(toolBtn, scopeOpen && "bg-divider text-fg")}
            title="検索範囲を選択"
            disabled={running}
            onClick={() => setScopeOpen((o) => !o)}
          >
            <span className="inline-flex items-center">
              <Icon name={scope.iconName} size={13} />
            </span>
            <span className="max-md:max-w-[80px] max-md:truncate">{scope.label}</span>
            <svg viewBox="0 0 16 16" width="9" height="9">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <ScopePicker
            open={scopeOpen}
            anchorRef={scopeRef}
            value={scope}
            onChange={onChangeScope}
            onClose={() => setScopeOpen(false)}
            attachmentCount={attachments.filter((a) => a.status === "ready").length}
          />
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onChangeModel}
            disabled={running}
            className="inline-flex h-7 shrink items-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 bg-transparent px-2.5 text-[12px] font-medium text-fg-2 hover:bg-divider hover:text-fg max-md:max-w-[36vw] max-md:overflow-hidden max-md:text-ellipsis max-md:px-2 max-md:text-[11.5px]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {model.label}
            <svg viewBox="0 0 16 16" width="10" height="10">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              title="実行を停止"
              className="grid h-8 w-8 shrink-0 animate-[ar-hl-pulse_1.6s_ease-in-out_infinite] place-items-center rounded-lg border-0 bg-accent text-white max-md:h-[34px] max-md:w-[34px]"
            >
              <svg viewBox="0 0 16 16" width="10" height="10">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 text-white transition-[background,filter] max-md:h-[34px] max-md:w-[34px]",
                canSubmit ? "bg-accent hover:brightness-105" : "cursor-not-allowed bg-divider text-muted-2",
              )}
            >
              <svg viewBox="0 0 16 16" width="13" height="13">
                <path d="M8 13V3M8 3l-4 4M8 3l4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="pt-2 text-center font-mono text-[10.5px] text-muted-2 max-md:hidden">
        {running ? (
          "⌘+⌫ で実行をキャンセル"
        ) : (
          <>
            Enterで送信 · Shift+Enterで改行 · ファイルをドラッグ&ドロップ · <kbd>⌘N</kbd> で新規スレッド
          </>
        )}
      </div>
    </form>
  );
}
