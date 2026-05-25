"use client";

import { cn } from "@/lib/utils";
import type { CitationStyle } from "@/lib/types";

interface Props {
  text: string;
  onCite: (n: number) => void;
  citationStyle: CitationStyle;
}

function citeBtnClass(style: CitationStyle) {
  const base =
    "inline-flex cursor-pointer items-center justify-center border-0 font-mono leading-none transition-[background,transform] duration-100 hover:-translate-y-px";
  if (style === "chip")
    return cn(base, "mx-0.5 h-[18px] rounded-[5px] border border-accent-soft bg-surface px-[5px] text-[10.5px] font-semibold text-accent hover:bg-accent-soft");
  if (style === "pill")
    return cn(base, "mx-0.5 h-[18px] rounded-full bg-accent px-[7px] text-[10.5px] font-semibold text-white");
  // numbered (superscript)
  return cn(base, "mx-px h-[14px] min-w-[14px] rounded-[4px] bg-accent-soft px-[3px] align-super text-[9.5px] font-bold text-accent hover:bg-accent hover:text-white");
}

/** Renders markdown-lite (**bold**, bullets, [N] citations) used by answers. */
export function CitedText({ text, onCite, citationStyle }: Props) {
  const btnCls = citeBtnClass(citationStyle);
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    if (line.trim() === "") {
      elements.push(<br key={`br-${lineIdx}`} />);
      return;
    }
    const isHeading = line.startsWith("**") && line.endsWith("**") && !line.slice(2, -2).includes("**");
    const isBullet = line.startsWith("- ") || line.startsWith("• ");
    const work = isBullet ? line.slice(2) : line;

    // Tokenize bold + citation groups.
    const tokens: { type: "text" | "bold" | "cite"; val: string }[] = [];
    const re = /(\*\*[^*]+\*\*|\[\d+\](?:\[\d+\])*)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(work)) !== null) {
      if (m.index > last) tokens.push({ type: "text", val: work.slice(last, m.index) });
      if (m[0].startsWith("**")) tokens.push({ type: "bold", val: m[0].slice(2, -2) });
      else tokens.push({ type: "cite", val: m[0] });
      last = m.index + m[0].length;
    }
    if (last < work.length) tokens.push({ type: "text", val: work.slice(last) });

    const inner = tokens.map((t, ti) => {
      if (t.type === "bold") return <strong key={ti} className="font-semibold text-fg">{t.val}</strong>;
      if (t.type === "cite") {
        const nums = [...t.val.matchAll(/\[(\d+)\]/g)].map((x) => x[1]);
        return (
          <span key={ti} className="inline">
            {nums.map((n) => (
              <button key={n} className={btnCls} title={`引用 ${n} を開く`} onClick={() => onCite(Number(n))}>
                {citationStyle === "chip" ? `[${n}]` : n}
              </button>
            ))}
          </span>
        );
      }
      return <span key={ti}>{t.val}</span>;
    });

    if (isHeading) {
      elements.push(
        <div key={`h-${lineIdx}`} className="mb-0.5 mt-3.5 text-[13.5px] font-bold tracking-[-0.005em] text-fg">
          {line.slice(2, -2)}
        </div>,
      );
    } else if (isBullet) {
      elements.push(
        <div key={`b-${lineIdx}`} className="my-px flex items-start gap-2.5 pl-1 leading-[1.65] text-fg-2 [overflow-wrap:anywhere]">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted" />
          <span>{inner}</span>
        </div>,
      );
    } else {
      elements.push(
        <div key={`p-${lineIdx}`} className="my-0.5 leading-[1.65] text-fg-2 [text-wrap:pretty] [overflow-wrap:anywhere]">
          {inner}
        </div>,
      );
    }
  });

  return <>{elements}</>;
}
