"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { CitationMap, Source, SourceType } from "@/lib/types";

export type RightPanelAction = "open-source" | "download" | "share";

interface Props {
  sources: Source[];
  citationMap: CitationMap;
  activeSourceId: string;
  highlightSectionId: string | null;
  onSetActive: (id: string) => void;
  onClose: () => void;
  onAction: (kind: RightPanelAction, source: Source) => void;
}

function SourceIcon({ type }: { type: SourceType }) {
  const map: Record<SourceType, React.ReactNode> = {
    meeting: (
      <>
        <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M5 2v3M11 2v3M2 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
    wiki: <path d="M3 2.5h8a2 2 0 012 2v9.5a1 1 0 01-1.5.8L8 13l-3.5 1.8a1 1 0 01-1.5-.8V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />,
    slack: <path d="M3 9.5a2 2 0 110-4h7a2 2 0 110 4M9.5 3a2 2 0 110 4M6.5 13a2 2 0 110-4M6.5 13V6.5M9.5 7v6.5a2 2 0 102-2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />,
    doc: (
      <>
        <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        <path d="M10 2v3h3M6 8h5M6 11h5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 16 16" width="13" height="13">
      {map[type]}
    </svg>
  );
}

const iconBtn = "grid h-[26px] w-[26px] place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-divider hover:text-fg";

export function RightPanel({ sources, citationMap, activeSourceId, highlightSectionId, onSetActive, onClose, onAction }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlightSectionId || !hlRef.current || !bodyRef.current) return;
    bodyRef.current.scrollTo({ top: Math.max(0, hlRef.current.offsetTop - 80), behavior: "smooth" });
  }, [highlightSectionId, activeSourceId]);

  const active = sources.find((s) => s.id === activeSourceId) || sources[0];
  const citationNum = (id: string) => {
    const entry = Object.entries(citationMap).find(([, c]) => c.sourceId === id);
    return entry ? entry[0] : "?";
  };

  const panelCls =
    "grid min-h-0 min-w-0 overflow-hidden border-l-[0.5px] border-divider bg-bg-2 max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-[60] max-wide:w-[min(440px,50vw)] max-wide:border-l-0 max-wide:shadow-[-8px_0_32px_rgba(0,0,0,0.16)] max-md:w-[min(440px,92vw)] wide:static wide:z-auto wide:w-auto wide:shadow-none";

  // sources はストリーミング完了(done)まで空。空状態でクラッシュしないよう placeholder を出す。
  if (!active) {
    return (
      <div className={cn(panelCls, "grid-rows-[auto_1fr]")}>
        <div className="flex h-[52px] items-center justify-between border-b-[0.5px] border-divider px-4 max-md:px-3.5">
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">一次資料</span>
          <button className={iconBtn} title="閉じる" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="grid place-items-center px-6 text-center text-[12.5px] leading-[1.6] text-muted">
          回答の生成が完了すると、参照された一次資料がここに表示されます。
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_1fr_auto] overflow-hidden border-l-[0.5px] border-divider bg-bg-2 max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-[60] max-wide:w-[min(440px,50vw)] max-wide:border-l-0 max-wide:shadow-[-8px_0_32px_rgba(0,0,0,0.16)] max-md:w-[min(440px,92vw)] wide:static wide:z-auto wide:w-auto wide:shadow-none">
      {/* Head */}
      <div className="flex h-[52px] items-center justify-between border-b-[0.5px] border-divider px-4 max-md:px-3.5">
        <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M6 6h4M6 8.5h4M6 11h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>一次資料</span>
          <span className="rounded-full bg-divider px-1.5 py-px font-mono text-[10.5px] text-muted">{sources.length}</span>
        </div>
        <div className="flex gap-0.5">
          <button className={iconBtn} title="ソースを新しいタブで開く" onClick={() => onAction("open-source", active)}>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M6 3H3v10h10v-3M9 3h4v4M13 3l-6 6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className={iconBtn} title="閉じる" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-col gap-0.5 border-b-[0.5px] border-divider px-2 pb-1 pt-2">
        {sources.map((s) => (
          <button
            key={s.id}
            title={s.title}
            onClick={() => onSetActive(s.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12px]",
              s.id === active.id ? "bg-surface font-medium text-fg shadow-e1" : "bg-transparent text-fg-2 hover:bg-divider hover:text-fg",
            )}
          >
            <span className="shrink-0 font-mono text-[10px] font-semibold text-accent">[{citationNum(s.id)}]</span>
            <span className={cn("grid place-items-center", s.id === active.id ? "text-fg" : "text-muted")}>
              <SourceIcon type={s.type} />
            </span>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
          </button>
        ))}
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1 border-b-[0.5px] border-divider bg-surface-2 px-4 py-2.5 max-md:px-3.5">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="min-w-[32px] font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted-2">パス</span>
          <code className="break-all font-mono text-[11px] text-fg-2">{active.path}</code>
        </div>
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="min-w-[32px] font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted-2">出典</span>
          <span className="text-[11px] text-fg-2">{active.author}</span>
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="overflow-y-auto px-5 pb-6 pt-[18px] max-md:px-3.5">
        <div className="mb-4 flex items-start gap-2.5">
          <span className="pt-[3px] text-accent">
            <SourceIcon type={active.type} />
          </span>
          <h2 className="m-0 text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-fg">{active.title}</h2>
        </div>
        {active.sections.map((sec) => {
          const isHl = sec.id === highlightSectionId;
          return (
            <div
              key={sec.id}
              ref={isHl ? hlRef : null}
              className={cn(
                "relative mb-2.5 rounded-[10px] border-[0.5px] border-transparent px-3.5 py-3 transition-[background,box-shadow]",
                isHl && "animate-hl-pulse border-accent bg-accent-soft",
              )}
            >
              {isHl && (
                <div className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-white">
                  <svg viewBox="0 0 12 12" width="9" height="9">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  引用箇所
                </div>
              )}
              <h3 className="mb-1.5 text-[12.5px] font-bold tracking-[-0.005em] text-fg">{sec.heading}</h3>
              <div className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2">{sec.body}</div>
            </div>
          );
        })}
      </div>

      {/* Foot */}
      <div className="flex items-center gap-1.5 border-t-[0.5px] border-divider px-3.5 py-2.5 max-md:flex-wrap max-md:gap-y-2">
        <button className="inline-flex h-[26px] items-center gap-[5px] rounded-[7px] border-[0.5px] border-divider-strong bg-surface px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-2" onClick={() => onAction("download", active)}>
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          ダウンロード
        </button>
        <button className="inline-flex h-[26px] items-center gap-[5px] rounded-[7px] border-[0.5px] border-divider-strong bg-surface px-2.5 text-[11.5px] font-medium text-fg-2 hover:bg-surface-2" onClick={() => onAction("share", active)}>
          <svg viewBox="0 0 16 16" width="11" height="11">
            <circle cx="4" cy="8" r="1.5" fill="currentColor" />
            <circle cx="12" cy="4" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <path d="M5.3 7.3 10.7 4.7M5.3 8.7l5.4 2.6" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          共有
        </button>
        <div className="flex-1 max-md:hidden" />
        <span className="font-mono text-[11px] text-muted max-md:ml-auto">
          関連度 <strong className="text-accent">0.94</strong>
        </span>
      </div>
    </div>
  );
}
