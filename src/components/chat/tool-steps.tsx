"use client";

import { cn, formatMs } from "@/lib/utils";
import type { RerankHit, ToolCall, ToolName, ToolStatus, ToolView } from "@/lib/types";

const TOOL_ICONS: Partial<Record<ToolName, React.ReactNode>> = {
  rewrite_query: <path d="M3 8h7M7 5l-3 3 3 3M13 4v8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  vector_search: (
    <>
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </>
  ),
  retrieve: (
    <>
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </>
  ),
  answer: <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  bm25_search: <path d="M2 4h12M2 8h8M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  rerank: (
    <>
      <path d="M3 11l3-3 3 3 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4h3v3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  fetch_document: (
    <>
      <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      <path d="M10 2v3h3M6 8h5M6 11h5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  summarize: <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
};

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running")
    return (
      <span className="grid h-4 w-4 place-items-center" aria-label="実行中">
        <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
      </span>
    );
  if (status === "done")
    return (
      <span className="grid h-4 w-4 place-items-center text-accent" aria-label="完了">
        <svg viewBox="0 0 16 16" width="11" height="11">
          <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  if (status === "pending")
    return (
      <span className="grid h-4 w-4 place-items-center" aria-label="待機中">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-2" />
      </span>
    );
  return (
    <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-[#B83A1F] text-[9px] font-bold text-white" aria-label="エラー">
      !
    </span>
  );
}

const preCls =
  "m-0 whitespace-pre-wrap break-words rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-fg-2";

const sectionLabelCls = "mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted";

function hasInputData(input: Record<string, unknown>): boolean {
  return Object.keys(input).length > 0;
}

function isExpandable(step: ToolCall): boolean {
  return hasInputData(step.input) || step.output != null;
}

interface RetrieveHit {
  n: number;
  title: string;
  heading: string;
  snippet: string;
}

/** retrieve / fetch_document の出力テキスト（"[N] Title — heading\nbody"）を構造化する。 */
function parseRetrieveResult(text: unknown): RetrieveHit[] {
  if (typeof text !== "string" || !text) return [];
  const hits: RetrieveHit[] = [];
  // 各エントリは空行 + `[N]` 行始まりで区切る。最初のエントリは split で先頭に来る。
  for (const part of text.split(/\n\n(?=\[\d+\])/)) {
    const m = part.match(/^\[(\d+)\]\s*(.+?)\s*—\s*([^\n]+)\n?([\s\S]*)$/);
    if (m) {
      hits.push({
        n: Number(m[1]),
        title: m[2].trim(),
        heading: m[3].trim(),
        snippet: m[4].trim(),
      });
    }
  }
  return hits;
}

function KeyValueGrid({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 font-mono text-[11.5px] leading-[1.55]">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <span className="text-muted-2">{r.k}</span>
          <span className="text-fg tabular-nums">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

function formatTokenCount(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ToolInputBlock({ step }: { step: ToolCall }) {
  if (step.name === "answer" && typeof step.input.model === "string") {
    return <KeyValueGrid rows={[{ k: "model", v: step.input.model }]} />;
  }
  if (step.name === "retrieve" && typeof step.input.query === "string") {
    return (
      <div className="rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-2">query</div>
        <div className="text-[12.5px] leading-[1.5] text-fg">{step.input.query}</div>
      </div>
    );
  }
  if (step.name === "fetch_document") {
    const ref = step.input.ref;
    const document = step.input.document;
    return (
      <div className="space-y-[3px] rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-fg-2">
        {ref != null && (
          <div>
            <span className="text-muted-2">出典: </span>
            <span className="text-fg">[{String(ref)}]</span>
          </div>
        )}
        {document != null && (
          <div>
            <span className="text-muted-2">文書: </span>
            <span className="text-fg">{String(document)}</span>
          </div>
        )}
      </div>
    );
  }
  return <pre className={preCls}>{JSON.stringify(step.input, null, 2)}</pre>;
}

function ToolOutputBlock({ step }: { step: ToolCall }) {
  const output = step.output;
  if (!output) return null;

  if (step.name === "answer") {
    const rows: { k: string; v: React.ReactNode }[] = [
      { k: "入力トークン", v: formatTokenCount(output.inputTokens) },
      { k: "出力トークン", v: formatTokenCount(output.outputTokens) },
      { k: "合計トークン", v: formatTokenCount(output.totalTokens) },
    ];
    if (typeof output.cachedInputTokens === "number" && output.cachedInputTokens > 0) {
      rows.push({ k: "キャッシュ読込", v: formatTokenCount(output.cachedInputTokens) });
    }
    return <KeyValueGrid rows={rows} />;
  }

  if (step.name === "rerank" && Array.isArray(output.selected)) {
    return (
      <div className="flex flex-col gap-[5px] py-1">
        {(output.selected as RerankHit[]).map((s) => (
          <div
            key={s.id}
            className="grid grid-cols-[80px_42px_1fr] items-center gap-2.5 text-[11.5px] max-md:grid-cols-[90px_38px_1fr] max-md:gap-2"
          >
            <div className="h-[5px] overflow-hidden rounded-full bg-divider">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${s.score * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] font-semibold text-accent">{s.score.toFixed(2)}</span>
            <span className="truncate text-fg-2">{s.title}</span>
          </div>
        ))}
      </div>
    );
  }

  if ((step.name === "retrieve" || step.name === "fetch_document") && typeof output.result === "string") {
    const hits = parseRetrieveResult(output.result);
    if (hits.length) {
      return (
        <div className="overflow-hidden rounded-lg border-[0.5px] border-divider bg-code-bg">
          {hits.map((h, i) => (
            <div
              key={`${h.n}-${i}`}
              className={cn(
                "grid grid-cols-[28px_1fr] gap-2 px-3 py-2.5",
                i > 0 && "border-t-[0.5px] border-divider",
              )}
            >
              <span className="pt-px font-mono text-[11px] font-semibold text-accent">[{h.n}]</span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-fg">{h.title}</div>
                <div className="truncate font-mono text-[10.5px] text-muted-2">{h.heading}</div>
                {h.snippet && (
                  <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11.5px] leading-[1.5] text-fg-2">
                    {h.snippet}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    // パースに失敗（"該当する資料は見つかりませんでした。" 等）した場合は本文をそのまま見せる。
    return (
      <div className="rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 text-[12px] leading-[1.55] text-fg-2">
        {output.result}
      </div>
    );
  }

  return <pre className={preCls}>{JSON.stringify(output, null, 2)}</pre>;
}

function ToolStepCard({ step, expanded, onToggle }: { step: ToolCall; expanded: boolean; onToggle: () => void }) {
  const expandable = isExpandable(step);
  const showInput = hasInputData(step.input);
  const showOutput = step.output != null;
  return (
    <div className="border-b-[0.5px] border-divider last:border-b-0">
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? expanded : undefined}
        className={cn(
          "grid w-full grid-cols-[16px_16px_auto_auto_1fr_auto_16px] items-center gap-2.5 border-0 px-3.5 py-[9px] text-left text-[12.5px] text-fg",
          "max-md:grid-cols-[16px_16px_1fr_auto_16px] max-md:gap-2 max-md:px-3 max-md:text-[12px]",
          expandable ? "cursor-pointer hover:bg-surface" : "cursor-default",
          step.status === "running" && "bg-accent-soft",
        )}
      >
        <StatusIcon status={step.status} />
        <span className="grid place-items-center text-accent">
          <svg viewBox="0 0 16 16" width="13" height="13">
            {TOOL_ICONS[step.name]}
          </svg>
        </span>
        <span className="font-mono text-[11.5px] font-semibold text-fg">{step.name}</span>
        <span className="max-w-[110px] truncate rounded-full bg-divider px-[7px] py-px text-[11px] text-muted max-md:hidden">
          {step.label}
        </span>
        <span className="min-w-0 truncate text-[12px] text-muted max-md:hidden">{step.summary}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{formatMs(step.durationMs)}</span>
        {expandable ? (
          <span className={cn("text-muted transition-transform", expanded && "rotate-180")}>
            <svg viewBox="0 0 16 16" width="11" height="11">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span aria-hidden className="block h-[11px] w-[11px]" />
        )}
      </button>
      {expandable && expanded && (
        <div className="flex flex-col gap-2.5 border-t-[0.5px] border-dashed border-divider bg-surface px-3.5 pb-3.5 pl-10 pt-2 max-md:pl-3.5">
          {showInput && (
            <div>
              <div className={sectionLabelCls}>{step.name === "answer" ? "モデル" : "入力"}</div>
              <ToolInputBlock step={step} />
            </div>
          )}
          {showOutput && (
            <div>
              <div className={sectionLabelCls}>{step.name === "answer" ? "使用トークン" : "出力"}</div>
              <ToolOutputBlock step={step} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolStepTimeline({ step, expanded, onToggle, isLast }: { step: ToolCall; expanded: boolean; onToggle: () => void; isLast: boolean }) {
  const expandable = isExpandable(step);
  const showInput = hasInputData(step.input);
  const showOutput = step.output != null;
  return (
    <div className="grid grid-cols-[22px_1fr]">
      <div className="grid grid-rows-[auto_1fr] items-start justify-items-center pt-0.5">
        <div className="grid h-[22px] w-[22px] place-items-center bg-surface-2">
          <StatusIcon status={step.status} />
        </div>
        {!isLast && <div className="min-h-4 w-[1.5px] flex-1 bg-divider-strong" />}
      </div>
      <div className="min-w-0 pb-3 pl-1">
        <button
          type="button"
          onClick={expandable ? onToggle : undefined}
          aria-expanded={expandable ? expanded : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 border-0 bg-transparent py-0.5 text-left text-fg",
            expandable ? "cursor-pointer" : "cursor-default",
          )}
        >
          <span className="font-mono text-[11.5px] font-semibold text-fg">{step.name}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{step.summary}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted">{formatMs(step.durationMs)}</span>
        </button>
        {expandable && expanded && (
          <div className="flex flex-col gap-2 pt-2">
            {showInput && (
              <div>
                <div className={sectionLabelCls}>{step.name === "answer" ? "モデル" : "入力"}</div>
                <ToolInputBlock step={step} />
              </div>
            )}
            {showOutput && (
              <div>
                <div className={sectionLabelCls}>{step.name === "answer" ? "使用トークン" : "出力"}</div>
                <ToolOutputBlock step={step} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolStepLog({ steps }: { steps: ToolCall[] }) {
  const lines: { t: number; name: string; msg: string; kind: string }[] = [];
  let t = 0;
  steps.forEach((s) => {
    const start = t;
    lines.push({ t: start, name: s.name, msg: "started", kind: "start" });
    const keys = Object.keys(s.input);
    if (keys.length) {
      const k = keys[0];
      const v = s.input[k];
      lines.push({ t: start, name: s.name, msg: `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`, kind: "param" });
    }
    if (s.status === "done") {
      lines.push({ t: start + s.durationMs, name: s.name, msg: `done in ${formatMs(s.durationMs)} · ${s.summary}`, kind: "done" });
      t = start + s.durationMs;
    } else if (s.status === "running") {
      lines.push({ t: start + (s.durationMs || 0), name: s.name, msg: "streaming…", kind: "running" });
    }
  });
  const fmtT = (ms: number) => `+${Math.floor(ms / 1000).toString().padStart(2, "0")}.${(ms % 1000).toString().padStart(3, "0").slice(0, 3)}`;

  return (
    <div className="max-h-80 overflow-y-auto bg-code-bg px-4 pb-3.5 pt-2.5 font-mono text-[11px] leading-[1.65] text-fg-2 max-md:max-h-[260px] max-md:px-3 max-md:text-[10.5px]">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-3 py-px">
          <span className="shrink-0 text-muted-2">{fmtT(l.t)}</span>
          <span className={cn("min-w-[110px] shrink-0 max-md:min-w-[90px]", l.kind === "done" ? "text-accent" : "text-accent")}>{l.name}</span>
          <span
            className={cn(
              "min-w-0 flex-1 break-words",
              l.kind === "done" ? "text-fg" : l.kind === "param" ? "text-muted" : l.kind === "running" ? "text-accent" : "text-fg-2",
            )}
          >
            {l.msg}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  steps: ToolCall[];
  variant: ToolView;
  expandedMap: Record<string, boolean>;
  onToggleStep: (id: string) => void;
}

export function ToolSteps({ steps, variant, expandedMap, onToggleStep }: Props) {
  if (variant === "log") return <ToolStepLog steps={steps} />;
  if (variant === "timeline") {
    return (
      <div className="px-3.5 pb-3 pt-2 max-md:px-3">
        {steps.map((s, i) => (
          <ToolStepTimeline key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} isLast={i === steps.length - 1} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {steps.map((s) => (
        <ToolStepCard key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} />
      ))}
    </div>
  );
}
