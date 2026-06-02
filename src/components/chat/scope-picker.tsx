"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { ALL_CONNECTORS, getScopePresets } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { ScopeValue } from "@/lib/types";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";

interface Props {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  value: ScopeValue;
  onChange: (scope: ScopeValue) => void;
  onClose: () => void;
  attachmentCount: number;
}

export function ScopePicker({ open, anchorRef, value, onChange, onClose, attachmentCount }: Props) {
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const [customSources, setCustomSources] = useState<string[]>(value.sources || ["confluence", "notion", "drive", "slack"]);
  const [mode, setMode] = useState<"preset" | "custom">(value.id === "custom" ? "custom" : "preset");
  const { t, locale } = useT();
  const scopePresets = getScopePresets(locale);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".scope-pop") && !anchorRef.current?.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const toggleSource = (id: string) => {
    setCustomSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
    setMode("custom");
  };

  const applyCustom = () => {
    onChange({ id: "custom", label: interpolate(t.chat.customSourcesLabel, { n: customSources.length }), iconName: "target", sources: customSources });
    onClose();
  };

  return (
    <div
      className="scope-pop fixed z-[150] flex max-h-[480px] w-[340px] animate-pop-in flex-col overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface shadow-e3 max-md:max-h-[60vh] max-md:w-[min(340px,calc(100vw-20px))] max-md:max-w-[calc(100vw-20px)]"
      style={{ left: pos.left, bottom: pos.bottom }}
    >
      <span className="absolute -bottom-[6px] left-[18px] h-2.5 w-2.5 rotate-45 border-b-[0.5px] border-r-[0.5px] border-divider-strong bg-surface" />
      <div className="flex items-center justify-between border-b-[0.5px] border-divider px-3.5 py-2.5 text-[12px] font-semibold text-muted">
        <span>{t.chat.scopeHeader}</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="overflow-y-auto p-1.5">
        <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-2">{t.chat.scopePresets}</div>
        {scopePresets.map((p) => {
          const isFiles = p.id === "files";
          const disabled = isFiles && !attachmentCount;
          const active = value.id === p.id;
          return (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => {
                onChange(p);
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left transition-colors",
                active && "bg-accent-soft",
                disabled ? "cursor-not-allowed opacity-50" : "hover:bg-divider",
              )}
            >
              <span className={cn("inline-flex w-4 items-center justify-center", active ? "text-accent" : "text-muted")}>
                <Icon name={p.iconName} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                  {p.label}
                  {isFiles && attachmentCount > 0 && (
                    <span className="rounded-full border-[0.5px] border-accent/40 px-1.5 py-px font-mono text-[9.5px] font-bold text-accent">
                      {attachmentCount}
                    </span>
                  )}
                </div>
                <div className="mt-px text-[11px] text-muted">{disabled ? t.chat.noFilesUploaded : p.desc}</div>
              </div>
              {active && (
                <svg viewBox="0 0 16 16" width="12" height="12" className="text-accent">
                  <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          );
        })}

        <div className="mx-1 my-1.5 h-px bg-divider" />

        <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.07em] text-muted-2">{t.chat.scopeCustom}</div>
        <div className="flex flex-col gap-px px-0.5 pb-1">
          {ALL_CONNECTORS.map((s) => {
            const checked = customSources.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleSource(s.id)}
                className="flex w-full items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-divider"
              >
                <span
                  className={cn(
                    "grid h-[15px] w-[15px] shrink-0 place-items-center rounded border-[1.5px] transition-colors",
                    checked ? "border-accent bg-accent" : "border-divider-strong",
                  )}
                >
                  {checked && (
                    <svg viewBox="0 0 12 12" width="9" height="9">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span
                  className="inline-flex w-3.5 items-center justify-center text-[var(--connector-color)] dark:text-[var(--connector-color-dark)]"
                  style={
                    {
                      "--connector-color": s.color,
                      "--connector-color-dark": s.darkColor ?? s.color,
                    } as React.CSSProperties
                  }
                >
                  <Icon name={s.iconName} size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg-2">{s.label}</span>
                <span className="font-mono text-[10px] text-muted-2">{s.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {mode === "custom" && (
        <div className="flex items-center justify-between border-t-[0.5px] border-divider bg-surface-2 px-3.5 py-2.5">
          <span className="text-[11.5px] text-muted">{interpolate(t.chat.customSourcesSelected, { n: customSources.length })}</span>
          <button
            disabled={!customSources.length}
            onClick={applyCustom}
            className="h-7 rounded-[7px] border-0 bg-accent px-3.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.chat.applyScope}
          </button>
        </div>
      )}
    </div>
  );
}
