"use client";

import { cn } from "@/lib/utils";
import { colLabel, type GridModel } from "@/components/documents/spreadsheet-model";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";

export interface SpreadsheetGridProps {
  sheetNames: string[];
  activeSheet: number;
  onSelectSheet: (i: number) => void;
  grid: GridModel; // クランプ済みモデル
  clamped: boolean;
  totalRows: number; // クランプ前の総行数（注記用）
  downloadHref: string;
}

export function SpreadsheetGrid({
  sheetNames, activeSheet, onSelectSheet, grid, clamped, totalRows, downloadHref,
}: SpreadsheetGridProps) {
  const { t, locale } = useT();
  // 結合に覆われる（左上以外の）セルは描画しない。"r:c" の集合で判定する。
  const covered = new Set<string>();
  for (const m of grid.merges) {
    for (let dr = 0; dr < m.rs; dr++) {
      for (let dc = 0; dc < m.cs; dc++) {
        if (dr === 0 && dc === 0) continue;
        covered.add(`${m.r + dr}:${m.c + dc}`);
      }
    }
  }
  const spanAt = new Map(grid.merges.map((m) => [`${m.r}:${m.c}`, m]));

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-auto">
        {grid.rowCount === 0 ? (
          <div className="grid h-full place-items-center text-[12px] text-muted">{t.documents.emptySheet}</div>
        ) : (
          <table className="border-collapse font-mono text-[12px] text-fg-2">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[40px] border-[0.5px] border-divider-strong bg-surface-2" />
                {Array.from({ length: grid.colCount }, (_, c) => (
                  <th
                    key={c}
                    className="sticky top-0 z-10 min-w-[80px] border-[0.5px] border-divider-strong bg-surface-2 px-2 py-1 text-center text-[10.5px] font-semibold text-muted"
                    style={grid.colWidths[c] ? { minWidth: grid.colWidths[c]! } : undefined}
                  >
                    {colLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.cells.map((row, r) => (
                <tr key={r}>
                  <th className="sticky left-0 z-10 border-[0.5px] border-divider-strong bg-surface-2 px-2 py-1 text-center text-[10.5px] font-semibold text-muted">
                    {r + 1}
                  </th>
                  {row.map((val, c) => {
                    if (covered.has(`${r}:${c}`)) return null;
                    const span = spanAt.get(`${r}:${c}`);
                    return (
                      <td
                        key={c}
                        rowSpan={span?.rs}
                        colSpan={span?.cs}
                        className={cn(
                          "max-w-[360px] truncate border-[0.5px] border-divider-strong px-2 py-1",
                          grid.numeric[r][c] && "text-right tabular-nums",
                        )}
                        title={val ?? undefined}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {clamped && (
        <div className="shrink-0 border-t-[0.5px] border-divider bg-bg-2 px-3 py-1.5 text-[11px] text-muted">
          {interpolate(t.documents.gridRowsShown, { total: totalRows.toLocaleString(locale === "zh" ? "zh-CN" : "ja-JP"), shown: grid.rowCount.toLocaleString(locale === "zh" ? "zh-CN" : "ja-JP") })}
          <a href={downloadHref} className="ml-1 font-medium text-accent hover:underline">{t.documents.gridDownload}</a>
        </div>
      )}

      {sheetNames.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t-[0.5px] border-divider bg-surface-2 px-2 py-1 [scrollbar-width:thin]">
          {sheetNames.map((name, i) => (
            <button
              key={i}
              onClick={() => onSelectSheet(i)}
              className={cn(
                "shrink-0 rounded-t-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                i === activeSheet ? "bg-surface text-fg shadow-e1" : "text-muted hover:text-fg",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
