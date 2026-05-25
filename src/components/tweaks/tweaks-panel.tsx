"use client";

import { useState } from "react";
import { ACCENT_PRESETS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Tweaks } from "@/lib/types";

interface Props {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
}

const sectionCls = "px-0 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2 first:pt-0";
const labelCls = "text-[11.5px] font-medium text-fg-2";

/** Floating display-preferences panel (theme / accent / tool view / density /
 * citation style). Self-contained — persists through useTweaks. */
export function TweaksPanel({ tweaks, setTweak }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className="fixed bottom-4 right-4 z-[120] flex max-h-[calc(100vh-32px)] w-[280px] flex-col overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface/85 text-[11.5px] shadow-e3 backdrop-blur-2xl backdrop-saturate-150 max-md:bottom-[84px] max-md:right-2.5 max-md:w-[calc(100vw-20px)] max-md:max-w-[320px]">
          <div className="flex items-center justify-between py-2.5 pl-[14px] pr-2">
            <b className="text-[12px] font-semibold tracking-[0.01em]">Tweaks</b>
            <button
              className="grid h-[22px] w-[22px] place-items-center rounded-md border-0 bg-transparent text-[13px] text-muted hover:bg-divider hover:text-fg"
              aria-label="Close tweaks"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-2.5 overflow-y-auto px-[14px] pb-[14px] pt-0.5">
            <div className={sectionCls}>テーマ</div>

            <div className="flex items-center justify-between gap-2.5">
              <span className={labelCls}>ダークモード</span>
              <button
                type="button"
                role="switch"
                aria-checked={tweaks.dark}
                onClick={() => setTweak("dark", !tweaks.dark)}
                className={cn(
                  "relative h-[18px] w-8 rounded-full p-0 transition-colors",
                  tweaks.dark ? "bg-accent" : "bg-divider-strong",
                )}
              >
                <i
                  className={cn(
                    "absolute left-0.5 top-0.5 h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform",
                    tweaks.dark && "translate-x-[14px]",
                  )}
                />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>アクセント</span>
              <div className="flex gap-1.5">
                {ACCENT_PRESETS.map((c) => {
                  const on = tweaks.accent.toLowerCase() === c.toLowerCase();
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => setTweak("accent", c)}
                      style={{ background: c }}
                      className={cn(
                        "relative h-[46px] flex-1 rounded-md transition-transform hover:-translate-y-px",
                        on
                          ? "shadow-[0_0_0_1.5px_rgba(0,0,0,0.85),0_2px_6px_rgba(0,0,0,0.15)]"
                          : "shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]",
                      )}
                    >
                      {on && (
                        <svg viewBox="0 0 14 14" className="absolute left-1.5 top-1.5 h-3.5 w-3.5 drop-shadow" aria-hidden>
                          <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" stroke="#fff" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={sectionCls}>表示</div>

            <Field label="ツール実行の表示">
              <select
                value={tweaks.toolView}
                onChange={(e) => setTweak("toolView", e.target.value as Tweaks["toolView"])}
                className="h-[26px] w-full rounded-[7px] border-[0.5px] border-divider-strong bg-surface-2 px-2 text-[11.5px] text-fg outline-none"
              >
                <option value="card">カード（折りたたみ）</option>
                <option value="timeline">タイムライン</option>
                <option value="log">ターミナル風ログ</option>
              </select>
            </Field>

            <Field label="情報密度">
              <Segmented
                value={tweaks.density}
                options={[
                  { value: "compact", label: "コンパクト" },
                  { value: "comfy", label: "快適" },
                ]}
                onChange={(v) => setTweak("density", v as Tweaks["density"])}
              />
            </Field>

            <Field label="引用スタイル">
              <select
                value={tweaks.citationStyle}
                onChange={(e) => setTweak("citationStyle", e.target.value as Tweaks["citationStyle"])}
                className="h-[26px] w-full rounded-[7px] border-[0.5px] border-divider-strong bg-surface-2 px-2 text-[11.5px] text-fg outline-none"
              >
                <option value="numbered">上付き番号</option>
                <option value="chip">[N] チップ</option>
                <option value="pill">ピル形</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Tweaks を開く"
          title="Tweaks"
          className="fixed bottom-4 right-4 z-[120] grid h-10 w-10 place-items-center rounded-full border-[0.5px] border-divider-strong bg-surface text-muted shadow-e2 transition-colors hover:text-fg max-md:bottom-[84px]"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path d="M2.5 4.5h7M11.5 4.5h2M2.5 8h2M6.5 8h7M2.5 11.5h7M11.5 11.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="10.3" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5.5" cy="8" r="1.2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="10.3" cy="11.5" r="1.2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-divider p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-[22px] flex-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium leading-tight transition-colors",
            value === o.value ? "bg-surface text-fg shadow-e1" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
