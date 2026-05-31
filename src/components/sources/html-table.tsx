"use client";

import { useState } from "react";
import { parseTableHtml, type InlineSegment } from "@/components/sources/parse-table-html";
import { TeXText } from "@/components/sources/tex-text";
import { useOverflow } from "@/components/sources/use-overflow";
import { TableSheet } from "@/components/sources/table-sheet";
import { cn } from "@/lib/utils";

function Seg({ s, renderMath }: { s: InlineSegment; renderMath?: boolean }) {
  const cls = cn(s.bold && "font-semibold", s.italic && "italic", s.underline && "underline");
  if (s.href) {
    return (
      <a href={s.href} target="_blank" rel="noopener noreferrer" className={cn(cls, "text-accent underline")}>
        {s.text}
      </a>
    );
  }
  const content = renderMath ? <TeXText text={s.text} /> : s.text;
  return cls ? <span className={cls}>{content}</span> : <>{content}</>;
}

function Lines({ lines, renderMath }: { lines: InlineSegment[][]; renderMath?: boolean }) {
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line.map((s, j) => <Seg key={j} s={s} renderMath={renderMath} />)}
        </span>
      ))}
    </>
  );
}

/** テーブルHTML文字列を整形描画する。解析できない場合は素のテキストにフォールバック。
 *  renderMath=true でセル内の TeX 数式を KaTeX 描画する（既定は無効＝引用パネルの通貨 $ 誤爆を避ける）。 */
export function HtmlTable({ html, className, renderMath }: { html: string; className?: string; renderMath?: boolean }) {
  const model = parseTableHtml(html);
  const { ref, overflow } = useOverflow<HTMLDivElement>();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!model) {
    return <div className={cn("whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2", className)}>{html}</div>;
  }

  const wide = overflow.left || overflow.right;

  const table = (
    <table className="w-full border-collapse text-[11.5px] leading-[1.5]">
      <tbody>
        {model.rows.map((row, ri) => (
          <tr key={ri}>
            {row.cells.map((c, ci) => {
              const Tag = c.header ? "th" : "td";
              return (
                <Tag
                  key={ci}
                  colSpan={c.colspan}
                  rowSpan={c.rowspan}
                  className={cn(
                    "border-[0.5px] border-divider px-2.5 py-1.5 align-top",
                    c.header ? "bg-surface-2 text-left font-semibold text-fg" : "text-fg-2",
                  )}
                >
                  <Lines lines={c.lines} renderMath={renderMath} />
                </Tag>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className={cn("group/tbl relative", className)}>
      <div
        ref={ref}
        data-overflow-left={overflow.left}
        data-overflow-right={overflow.right}
        className="overflow-x-auto rounded-[8px] border-[0.5px] border-divider"
      >
        {table}
      </div>

      {/* 左に続きがある合図（フェード） */}
      {overflow.left && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-[8px] bg-gradient-to-r from-bg-2 to-transparent"
        />
      )}

      {/* 右に続きがある合図（フェード＋シェブロン） */}
      {overflow.right && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px right-px flex w-12 items-center justify-end rounded-r-[8px] bg-gradient-to-l from-bg-2 via-bg-2 to-transparent pr-1"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" className="text-muted">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* 全画面拡大（デスクトップはホバー表示、モバイルは常時表示） */}
      {wide && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          title="表を全画面で開く"
          className="absolute right-1.5 top-1.5 z-[1] inline-flex h-6 items-center gap-1 rounded-[6px] border-[0.5px] border-divider-strong bg-surface/90 px-1.5 text-[10.5px] font-medium text-fg-2 opacity-0 backdrop-blur-sm transition-opacity hover:bg-surface group-hover/tbl:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        >
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M6 2H2v4M10 14h4v-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          拡大
        </button>
      )}

      {sheetOpen && <TableSheet onClose={() => setSheetOpen(false)}>{table}</TableSheet>}
    </div>
  );
}
