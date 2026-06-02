"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/types";
import { useT } from "@/i18n/context";

interface Props {
  open: boolean;
  item: Source | null;
  onClose: () => void;
  onCopyLink: (error?: boolean) => void;
}

export function ShareModal({ open, item, onClose, onCopyLink }: Props) {
  const { t } = useT();
  const [permission, setPermission] = useState("team");
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const PERMISSIONS: { id: string; iconName: IconName; label: string; desc: string }[] = [
    { id: "private", iconName: "lock", label: t.modals.sharePermPrivateLabel, desc: t.modals.sharePermPrivateDesc },
    { id: "team", iconName: "group", label: t.modals.sharePermTeamLabel, desc: t.modals.sharePermTeamDesc },
    { id: "link", iconName: "link", label: t.modals.sharePermLinkLabel, desc: t.modals.sharePermLinkDesc },
  ];

  const link = item ? `https://arag.dev/s/${item.id}` : "https://arag.dev/s/thread";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      onCopyLink();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onCopyLink(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.45)] p-6 backdrop-blur-[4px] motion-reduce:animate-none max-md:items-end max-md:p-0" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[460px] max-w-full animate-pop-in flex-col gap-4 rounded-[16px] border-[0.5px] border-divider-strong bg-surface p-[22px_22px_16px] shadow-e3 motion-reduce:animate-none max-md:w-full max-md:rounded-[18px_18px_0_0] max-md:p-[18px_18px_max(18px,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[16px] font-bold tracking-[-0.01em]">{item ? t.modals.shareItemTitle : t.modals.shareThreadTitle}</h3>
          <button className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label={t.common.close}>
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {item && (
          <div className="flex items-center gap-3 rounded-[10px] border-[0.5px] border-divider bg-surface-2 px-3 py-2.5">
            <span className="inline-flex items-center justify-center text-accent">
              <Icon name="doc" size={18} />
            </span>
            <div>
              <div className="text-[13px] font-semibold">{item.title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{item.path}</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-[10px] border border-divider-strong bg-surface-2 py-1 pl-3 pr-1 text-muted">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <path d="M7 9l2-2M5 11a3 3 0 010-4l2-2a3 3 0 014 4M11 5a3 3 0 010 4l-2 2a3 3 0 01-4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input type="text" value={link} readOnly className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12.5px] text-fg-2 outline-none max-md:text-[11.5px]" />
          <button
            onClick={copy}
            className={cn("h-[30px] rounded-[7px] border-0 px-3.5 text-[12px] font-semibold", copied ? "bg-accent text-white" : "bg-fg text-bg")}
          >
            {copied ? t.modals.shareCopiedBtn : t.modals.shareCopyBtn}
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-2">{t.modals.shareAccessLabel}</div>
          {PERMISSIONS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPermission(p.id)}
              className={cn(
                "flex items-center gap-3 rounded-[10px] border border-divider-strong px-3 py-2.5 text-left transition-colors",
                permission === p.id ? "border-accent bg-accent-soft" : "bg-surface hover:bg-surface-2",
              )}
            >
              <span className={cn("inline-flex items-center justify-center", permission === p.id ? "text-accent" : "text-muted")}>
                <Icon name={p.iconName} size={15} />
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-fg">{p.label}</div>
                <div className="mt-px text-[11.5px] text-muted">{p.desc}</div>
              </div>
              <span className={cn("grid h-4 w-4 place-items-center rounded-full border-[1.5px]", permission === p.id ? "border-accent" : "border-divider-strong")}>
                {permission === p.id && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-1 flex justify-end gap-2 max-md:[&>*]:flex-1">
          <button className="h-9 rounded-[9px] border border-divider-strong bg-transparent px-3.5 text-[13px] font-medium text-fg hover:bg-surface-2" onClick={onClose}>
            {t.modals.shareCancelBtn}
          </button>
          <button
            className="h-9 rounded-[9px] border-0 bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_1px_3px_var(--accent-glow)] hover:brightness-105"
            onClick={() => {
              copy();
              onClose();
            }}
          >
            {t.modals.shareCopyAndCloseBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
