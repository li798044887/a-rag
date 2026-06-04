"use client";

import { cn, formatMs } from "@/lib/utils";
import type { RerankHit, ToolCall, ToolName, ToolStatus, ToolView } from "@/lib/types";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";
import type { Dictionary } from "@/i18n/dictionary";

const LOG_DETAIL_MAX = 8;

interface CandidateHit {
  title: string;
  heading: string;
  score: number;
}

interface ExpandedHit {
  id: string;
  title: string;
  heading: string;
  score: number;
  page: number;
  blockType: string;
  expandedChars: number;
  preview: string;
}

interface GradeCandidate {
  chunkId: string;
  title: string;
  heading: string;
  score: number;
  kept: boolean;
}

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
  embed: (
    <>
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </>
  ),
  expand: <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  grade: <path d="M2.5 3.5h11l-4.3 5v4l-2.4-1.2V8.5L2.5 3.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  verify: (
    <>
      <path d="M8 2.2l4.5 1.8v3.6c0 2.7-1.9 4.6-4.5 5.4-2.6-.8-4.5-2.7-4.5-5.4V4L8 2.2z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      <path d="M6 7.8l1.5 1.5L10.3 6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  revise: (
    <>
      <path d="M10.5 3.2l2.3 2.3-6.6 6.6-2.9.6.6-2.9 6.6-6.6z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
      <path d="M9.3 4.4l2.3 2.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
};

function StatusIcon({ status, t }: { status: ToolStatus; t: Dictionary }) {
  if (status === "running")
    return (
      <span className="grid h-4 w-4 place-items-center" aria-label={t.chat.statusRunning}>
        <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
      </span>
    );
  if (status === "done")
    return (
      <span className="grid h-4 w-4 place-items-center text-accent" aria-label={t.chat.statusDone}>
        <svg viewBox="0 0 16 16" width="11" height="11">
          <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  if (status === "pending")
    return (
      <span className="grid h-4 w-4 place-items-center" aria-label={t.chat.statusPending}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted-2" />
      </span>
    );
  return (
    <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-[#B83A1F] text-[9px] font-bold text-white" aria-label={t.chat.statusError}>
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

function tokenRows(output: Record<string, unknown>, t: Dictionary): { k: string; v: React.ReactNode }[] {
  const rows: { k: string; v: React.ReactNode }[] = [
    { k: t.chat.inputTokens, v: formatTokenCount(output.inputTokens) },
    { k: t.chat.outputTokens, v: formatTokenCount(output.outputTokens) },
    { k: t.chat.totalTokens, v: formatTokenCount(output.totalTokens) },
  ];
  if (typeof output.cachedInputTokens === "number" && output.cachedInputTokens > 0) {
    rows.push({ k: t.chat.cacheTokens, v: formatTokenCount(output.cachedInputTokens) });
  }
  return rows;
}

function ToolInputBlock({ step, t }: { step: ToolCall; t: Dictionary }) {
  if (step.name === "answer" && typeof step.input.model === "string") {
    return <KeyValueGrid rows={[{ k: "model", v: step.input.model }]} />;
  }
  if ((step.name === "verify" || step.name === "revise") && typeof step.input.model === "string") {
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
            <span className="text-muted-2">{t.chat.sourceLabel}</span>
            <span className="text-fg">[{String(ref)}]</span>
          </div>
        )}
        {document != null && (
          <div>
            <span className="text-muted-2">{t.chat.documentLabel}</span>
            <span className="text-fg">{String(document)}</span>
          </div>
        )}
      </div>
    );
  }
  if (step.name === "vector_search" || step.name === "bm25_search") {
    const rows: { k: string; v: React.ReactNode }[] = [];
    if (typeof step.input.mode === "string") rows.push({ k: "mode", v: step.input.mode });
    return (
      <div className="space-y-2">
        {rows.length > 0 && <KeyValueGrid rows={rows} />}
        {typeof step.input.query === "string" && (
          <div className="rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-2">query</div>
            <div className="text-[12.5px] leading-[1.5] text-fg">{step.input.query}</div>
          </div>
        )}
      </div>
    );
  }
  if (step.name === "rerank") {
    const rows: { k: string; v: React.ReactNode }[] = [];
    if (step.input.model != null) rows.push({ k: "model", v: String(step.input.model) });
    if (step.input.top_n != null) rows.push({ k: "top_n", v: String(step.input.top_n) });
    if (rows.length) return <KeyValueGrid rows={rows} />;
  }
  if (step.name === "embed" && step.input.model != null) {
    return <KeyValueGrid rows={[{ k: "model", v: String(step.input.model) }]} />;
  }
  return <pre className={preCls}>{JSON.stringify(step.input, null, 2)}</pre>;
}

function ToolOutputBlock({ step, t }: { step: ToolCall; t: Dictionary }) {
  const output = step.output;
  if (!output) return null;

  if (step.name === "answer") {
    return <KeyValueGrid rows={tokenRows(output, t)} />;
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
  if ((step.name === "vector_search" || step.name === "bm25_search") && Array.isArray(output.hits)) {
    const hits = output.hits as CandidateHit[];
    if (hits.length === 0) {
      return <div className="px-1 py-1 text-[11.5px] text-muted">{t.chat.noCandidates}</div>;
    }
    // スコアは非負前提（dense=cosine, sparse=BM25/dot）。リスト内最大値でバー幅を正規化。
    const max = Math.max(...hits.map((h) => h.score), 1e-9);
    return (
      <div className="flex max-h-72 flex-col gap-[5px] overflow-y-auto py-1">
        {hits.map((h, i) => (
          <div
            key={i}
            className="grid grid-cols-[64px_42px_1fr] items-center gap-2.5 text-[11.5px] max-md:grid-cols-[54px_38px_1fr] max-md:gap-2"
          >
            <div className="h-[5px] overflow-hidden rounded-full bg-divider">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (h.score / max) * 100)}%` }} />
            </div>
            <span className="font-mono text-[11px] font-semibold text-accent">{h.score.toFixed(2)}</span>
            <span className="truncate text-fg-2">
              <span className="text-fg">{h.title}</span>
              {h.heading && <span className="text-muted-2"> — {h.heading}</span>}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (step.name === "embed") {
    return <KeyValueGrid rows={[{ k: "dims", v: String(output.dims ?? "—") }]} />;
  }
  if (step.name === "expand") {
    const expanded = Array.isArray(output.expanded) ? (output.expanded as ExpandedHit[]) : [];
    if (expanded.length === 0) {
      return <KeyValueGrid rows={[{ k: t.chat.expandCount, v: String(output.count ?? 0) }]} />;
    }
    return (
      <div className="flex flex-col gap-2">
        <KeyValueGrid rows={[{ k: t.chat.expandCount, v: String(output.count ?? expanded.length) }]} />
        <div className="overflow-hidden rounded-lg border-[0.5px] border-divider bg-code-bg">
          {expanded.map((h, i) => (
            <div key={`${h.id}-${i}`} className={cn("px-3 py-2.5", i > 0 && "border-t-[0.5px] border-divider")}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[11px] font-semibold tabular-nums text-accent">{h.score.toFixed(2)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{h.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-2">p.{h.page}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-2">{h.expandedChars}ch</span>
              </div>
              {h.heading && <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-2">{h.heading}</div>}
              {h.preview && <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11.5px] leading-[1.5] text-fg-2">{h.preview}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (step.name === "grade") {
    const candidates = Array.isArray(output.candidates) ? (output.candidates as GradeCandidate[]) : [];
    if (candidates.length === 0) return <pre className={preCls}>{JSON.stringify(output, null, 2)}</pre>;
    return (
      <div className="flex flex-col gap-2">
        <KeyValueGrid rows={[
          { k: "kept", v: `${String(output.kept ?? 0)} / ${String(output.total ?? candidates.length)}` },
          { k: "retry", v: output.needRetry ? "yes" : "no" },
        ]} />
        <div className="overflow-hidden rounded-lg border-[0.5px] border-divider bg-code-bg">
          {candidates.map((c, i) => (
            <div key={`${c.chunkId}-${i}`} className={cn("grid grid-cols-[58px_42px_1fr] items-start gap-2.5 px-3 py-2.5 text-[11.5px]", i > 0 && "border-t-[0.5px] border-divider")}>
              <span className={cn("rounded-full px-2 py-px text-center text-[10.5px] font-semibold", c.kept ? "bg-accent-soft text-accent" : "bg-divider text-muted")}>
                {c.kept ? "kept" : "skip"}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-accent">{c.score.toFixed(2)}</span>
              <span className="min-w-0">
                <span className="block truncate text-fg">{c.title}</span>
                {c.heading && <span className="block truncate font-mono text-[10.5px] text-muted-2">{c.heading}</span>}
              </span>
            </div>
          ))}
        </div>
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

  if (step.name === "verify") {
    const claims = Array.isArray(output.claims) ? (output.claims as string[]) : [];
    const message = output.checkableClaims === 0 ? t.chat.noCheckableClaims : t.chat.allGrounded;
    if (claims.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          <KeyValueGrid rows={tokenRows(output, t)} />
          <div className="rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 text-[12px] leading-[1.55] text-fg-2">
            {message}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <KeyValueGrid rows={tokenRows(output, t)} />
        <ul className="flex flex-col gap-1.5 rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5">
          {claims.map((c, i) => (
            <li key={i} className="grid grid-cols-[14px_1fr] gap-2 text-[12px] leading-[1.5] text-fg-2">
              <span className="pt-px text-center font-mono text-[11px] font-semibold text-[#B83A1F]">!</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{c}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (step.name === "revise") {
    return (
      <div className="flex flex-col gap-2">
        <KeyValueGrid rows={tokenRows(output, t)} />
        {typeof output.draft === "string" && (
          <div>
            <div className={sectionLabelCls}>{t.chat.sectionDraft}</div>
            <div className="whitespace-pre-wrap break-words rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 text-[12px] leading-[1.55] text-muted">
              {output.draft}
            </div>
          </div>
        )}
        {typeof output.revised === "string" && (
          <div>
            <div className={sectionLabelCls}>{t.chat.sectionRevised}</div>
            <div className="whitespace-pre-wrap break-words rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 text-[12px] leading-[1.55] text-fg-2">
              {output.revised}
            </div>
          </div>
        )}
      </div>
    );
  }

  return <pre className={preCls}>{JSON.stringify(output, null, 2)}</pre>;
}

function ToolStepCard({ step, expanded, onToggle, t }: { step: ToolCall; expanded: boolean; onToggle: () => void; t: Dictionary }) {
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
        <StatusIcon status={step.status} t={t} />
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
              <div className={sectionLabelCls}>{step.name === "answer" ? t.chat.sectionModel : t.chat.sectionInput}</div>
              <ToolInputBlock step={step} t={t} />
            </div>
          )}
          {showOutput && (
            <div>
              <div className={sectionLabelCls}>{step.name === "answer" ? t.chat.sectionUsedTokens : t.chat.sectionOutput}</div>
              <ToolOutputBlock step={step} t={t} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolStepTimeline({ step, expanded, onToggle, isLast, t }: { step: ToolCall; expanded: boolean; onToggle: () => void; isLast: boolean; t: Dictionary }) {
  const expandable = isExpandable(step);
  const showInput = hasInputData(step.input);
  const showOutput = step.output != null;
  return (
    <div className="grid grid-cols-[22px_1fr]">
      <div className="grid grid-rows-[auto_1fr] items-start justify-items-center pt-0.5">
        <div className="grid h-[22px] w-[22px] place-items-center bg-surface-2">
          <StatusIcon status={step.status} t={t} />
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
                <div className={sectionLabelCls}>{step.name === "answer" ? t.chat.sectionModel : t.chat.sectionInput}</div>
                <ToolInputBlock step={step} t={t} />
              </div>
            )}
            {showOutput && (
              <div>
                <div className={sectionLabelCls}>{step.name === "answer" ? t.chat.sectionUsedTokens : t.chat.sectionOutput}</div>
                <ToolOutputBlock step={step} t={t} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolStepLog({ steps, dict }: { steps: ToolCall[]; dict: Dictionary }) {
  const lines: { t: number; name: string; msg: string; kind: string }[] = [];
  let t = 0;
  steps.forEach((s) => {
    const start = t;
    const logName = (s.parentId ? "› " : "") + s.name;
    lines.push({ t: start, name: logName, msg: "started", kind: "start" });
    const keys = Object.keys(s.input);
    if (keys.length) {
      const k = keys[0];
      const v = s.input[k];
      lines.push({ t: start, name: logName, msg: `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`, kind: "param" });
    }
    if (s.status === "done") {
      lines.push({ t: start + s.durationMs, name: logName, msg: `done in ${formatMs(s.durationMs)} · ${s.summary}`, kind: "done" });
      const out = (s.output ?? {}) as Record<string, unknown>;
      const dt = start + s.durationMs;
      if ((s.name === "vector_search" || s.name === "bm25_search") && Array.isArray(out.hits)) {
        const hits = out.hits as { title: string; heading: string; score: number }[];
        hits.slice(0, LOG_DETAIL_MAX).forEach((h) =>
          lines.push({ t: dt, name: "", msg: `${h.score.toFixed(2)}  ${h.title}${h.heading ? ` — ${h.heading}` : ""}`, kind: "detail" }));
        if (hits.length > LOG_DETAIL_MAX)
          lines.push({ t: dt, name: "", msg: interpolate(dict.chat.moreItems, { n: hits.length - LOG_DETAIL_MAX }), kind: "detail" });
      } else if (s.name === "rerank" && Array.isArray(out.selected)) {
        const sel = out.selected as { score: number; title: string }[];
        sel.slice(0, LOG_DETAIL_MAX).forEach((h) =>
          lines.push({ t: dt, name: "", msg: `${h.score.toFixed(2)}  ${h.title}`, kind: "detail" }));
        if (sel.length > LOG_DETAIL_MAX)
          lines.push({ t: dt, name: "", msg: interpolate(dict.chat.moreItems, { n: sel.length - LOG_DETAIL_MAX }), kind: "detail" });
      }
      t = start + s.durationMs;
    } else if (s.status === "running") {
      lines.push({ t: start + (s.durationMs || 0), name: logName, msg: "streaming…", kind: "running" });
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
              l.kind === "done" ? "text-fg" : l.kind === "param" ? "text-muted" : l.kind === "running" ? "text-accent" : l.kind === "detail" ? "text-muted-2" : "text-fg-2",
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

/** フラットな steps を「ルート(parentId なし)」と「子(parentId 別)」に分ける。 */
function groupSteps(steps: ToolCall[]): { roots: ToolCall[]; childrenOf: Map<string, ToolCall[]> } {
  const roots: ToolCall[] = [];
  const childrenOf = new Map<string, ToolCall[]>();
  for (const s of steps) {
    if (s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s);
      childrenOf.set(s.parentId, arr);
    } else {
      roots.push(s);
    }
  }
  return { roots, childrenOf };
}

/** 子サブステップの行。詳細があれば展開可能。card / timeline 共通。 */
function SubStepRow({ step, expanded, onToggle, t }: { step: ToolCall; expanded: boolean; onToggle: () => void; t: Dictionary }) {
  const expandable = isExpandable(step);
  const showInput = hasInputData(step.input);
  const showOutput = step.output != null;
  return (
    <div>
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 border-0 bg-transparent py-[3px] text-left text-[11.5px] text-fg-2",
          expandable ? "cursor-pointer hover:text-fg" : "cursor-default",
        )}
      >
        <StatusIcon status={step.status} t={t} />
        <span className="grid place-items-center text-muted-2">
          <svg viewBox="0 0 16 16" width="12" height="12">{TOOL_ICONS[step.name]}</svg>
        </span>
        <span className="font-mono text-[11px] font-semibold text-fg-2">{step.name}</span>
        <span className="max-w-[150px] shrink-0 truncate rounded-full bg-divider px-[6px] py-px text-[10.5px] text-muted max-md:hidden">
          {step.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted">{step.summary}</span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-2">{formatMs(step.durationMs)}</span>
        {expandable ? (
          <span className={cn("text-muted-2 transition-transform", expanded && "rotate-180")}>
            <svg viewBox="0 0 16 16" width="10" height="10">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span aria-hidden className="block h-[10px] w-[10px]" />
        )}
      </button>
      {expandable && expanded && (
        <div className="flex flex-col gap-2 pb-2 pl-[26px] pt-1">
          {showInput && (
            <div>
              <div className={sectionLabelCls}>{t.chat.sectionInput}</div>
              <ToolInputBlock step={step} t={t} />
            </div>
          )}
          {showOutput && (
            <div>
              <div className={sectionLabelCls}>{t.chat.sectionOutput}</div>
              <ToolOutputBlock step={step} t={t} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubSteps({ steps, expandedMap, onToggleStep, t }: {
  steps: ToolCall[] | undefined;
  expandedMap: Record<string, boolean>;
  onToggleStep: (id: string) => void;
  t: Dictionary;
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-px border-l-[1.5px] border-divider pl-3 ml-[7px]">
      {steps.map((s) => (
        <SubStepRow key={s.id} step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} t={t} />
      ))}
    </div>
  );
}

export function ToolSteps({ steps, variant, expandedMap, onToggleStep }: Props) {
  const { t } = useT();
  if (variant === "log") return <ToolStepLog steps={steps} dict={t} />;

  const { roots, childrenOf } = groupSteps(steps);

  if (variant === "timeline") {
    return (
      <div className="px-3.5 pb-3 pt-2 max-md:px-3">
        {roots.map((s, i) => (
          <div key={s.id}>
            <ToolStepTimeline step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} isLast={i === roots.length - 1} t={t} />
            {childrenOf.has(s.id) && (
              <div className="mb-2 ml-[22px] pl-1">
                <SubSteps steps={childrenOf.get(s.id)} expandedMap={expandedMap} onToggleStep={onToggleStep} t={t} />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {roots.map((s) => (
        <div key={s.id}>
          <ToolStepCard step={s} expanded={!!expandedMap[s.id]} onToggle={() => onToggleStep(s.id)} t={t} />
          {childrenOf.has(s.id) && (
            <div className="border-b-[0.5px] border-divider bg-surface px-3.5 py-2 pl-10 max-md:pl-6">
              <SubSteps steps={childrenOf.get(s.id)} expandedMap={expandedMap} onToggleStep={onToggleStep} t={t} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
