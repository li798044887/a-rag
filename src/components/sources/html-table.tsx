import { parseTableHtml, type InlineSegment } from "@/components/sources/parse-table-html";
import { cn } from "@/lib/utils";

function Seg({ s }: { s: InlineSegment }) {
  const cls = cn(s.bold && "font-semibold", s.italic && "italic", s.underline && "underline");
  if (s.href) {
    return (
      <a href={s.href} target="_blank" rel="noopener noreferrer" className={cn(cls, "text-accent underline")}>
        {s.text}
      </a>
    );
  }
  return cls ? <span className={cls}>{s.text}</span> : <>{s.text}</>;
}

function Lines({ lines }: { lines: InlineSegment[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line.map((s, j) => <Seg key={j} s={s} />)}
        </span>
      ))}
    </>
  );
}

/** テーブルHTML文字列を整形描画する。解析できない場合は素のテキストにフォールバック。 */
export function HtmlTable({ html, className }: { html: string; className?: string }) {
  const model = parseTableHtml(html);
  if (!model) {
    return <div className={cn("whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2", className)}>{html}</div>;
  }
  return (
    <div className={cn("overflow-x-auto rounded-[8px] border-[0.5px] border-divider", className)}>
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
                    <Lines lines={c.lines} />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
