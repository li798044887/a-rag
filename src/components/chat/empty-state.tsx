"use client";

import { BrandMark, Icon } from "@/components/icons";
import { getSuggestedPrompts } from "@/lib/data";
import { formatLastSynced, type WorkspaceStats } from "@/lib/workspace-stats";
import type { AppUser } from "@/lib/types";
import { useT } from "@/i18n/context";
import type { Dictionary } from "@/i18n/dictionary";

function greeting(t: Dictionary) {
  const h = new Date().getHours();
  if (h < 11) return t.chat.greetingMorning;
  if (h < 18) return t.chat.greetingDay;
  return t.chat.greetingEvening;
}

interface EmptyStateProps {
  user: AppUser;
  stats: WorkspaceStats;
  onPickPrompt: (label: string) => void;
}

export function EmptyState({ user, stats, onPickPrompt }: EmptyStateProps) {
  const { locale, t } = useT();
  const localeStr = locale === "zh" ? "zh-CN" : "ja-JP";
  const suggestedPrompts = getSuggestedPrompts(locale);
  const meta = [
    [stats.indexedDocumentCount.toLocaleString(localeStr), t.chat.metaIndexed],
    [stats.connectedDataSourceCount.toLocaleString(localeStr), t.chat.metaConnected],
    [t.chat.metaLastSync, formatLastSynced(stats.lastSyncedAt, locale)],
  ];

  return (
    <div className="grid min-h-[calc(100vh-52px-130px)] min-w-0 place-items-center px-6 py-10 max-md:min-h-0 max-md:px-[18px] max-md:py-7">
      <div className="w-full max-w-[920px] min-w-0 text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-[16px] bg-accent text-white shadow-[0_6px_20px_var(--accent-glow)] max-md:mb-[18px] max-md:h-12 max-md:w-12 max-md:rounded-[14px]">
          <BrandMark size={24} className="max-md:h-[21px] max-md:w-[21px]" />
        </div>
        <h1 className="m-0 mb-2.5 text-[clamp(22px,3.4vw,32px)] font-bold tracking-[-0.02em] text-fg [text-wrap:balance] [word-break:keep-all] max-md:text-[clamp(20px,6.4vw,26px)]">
          {greeting(t)}{t.chat.greetingConnector}<span className="text-accent">{user.firstName}</span>{t.chat.greetingSuffix}
        </h1>
        <p className="m-0 mb-9 text-[15px] leading-[1.55] text-muted max-md:mb-[22px] max-md:text-[13.5px]">
          {t.chat.leadText}
        </p>

        <div className="mx-auto grid max-w-[820px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3 text-left max-md:max-w-none max-md:grid-cols-1 max-md:gap-2">
          {suggestedPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => onPickPrompt(p.label)}
              className="flex items-start gap-2.5 rounded-xl border border-divider-strong bg-surface px-3.5 py-3 text-[13px] font-medium leading-[1.45] text-fg transition-[transform,border-color,box-shadow] hover:-translate-y-px hover:border-accent hover:shadow-e2 max-md:rounded-[11px] max-md:px-3 max-md:py-[11px] max-md:text-[12.5px]"
            >
              <span className="inline-flex shrink-0 items-center justify-center pt-px text-accent">
                <Icon name={p.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{p.label}</span>
              <span className="rounded-full border-[0.5px] border-accent/40 px-[7px] py-0.5 text-[10px] font-semibold tracking-[0.02em] text-accent">{p.tag}</span>
            </button>
          ))}
        </div>

        <div className="mt-9 flex justify-center gap-6 border-t-[0.5px] border-divider pt-[18px] max-md:mt-6 max-md:flex-wrap max-md:gap-x-[18px] max-md:gap-y-2.5">
          {meta.map(([a, b]) => (
            <div key={b} className="text-[11px] text-muted max-md:text-[10.5px]">
              <strong className="text-fg">{a}</strong>
              {b}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
