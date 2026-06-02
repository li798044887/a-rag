"use client";

import { useEffect, useState } from "react";
import { SpreadsheetGrid } from "@/components/documents/spreadsheet-grid";
import { clampGrid, sheetToGrid, type GridModel } from "@/components/documents/spreadsheet-model";
import { useT } from "@/i18n/context";

const ROW_CLAMP = 2000;

interface Parsed {
  sheetNames: string[];
  grids: GridModel[]; // シート毎の素のグリッド（クランプ前）
}

/** プレビュー不可フォールバック（原本ダウンロード導線）。documents-modal と同等。 */
function Fallback({ docId }: { docId: string }) {
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.documents.spreadsheetErrorTitle}</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">{t.documents.spreadsheetErrorDescription}</div>
        <a href={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`} className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2">{t.documents.spreadsheetDownload}</a>
      </div>
    </div>
  );
}

export function SpreadsheetPreview({ docId, filename }: { docId: string; filename: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [active, setActive] = useState(0);

  // docId ごとに key で再マウントされる前提（初期 state = loading）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/raw`);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        if (!wb.SheetNames.length) throw new Error("no sheets");
        const grids = wb.SheetNames.map((n) => sheetToGrid(wb.Sheets[n]));
        if (cancelled) return;
        setParsed({ sheetNames: wb.SheetNames, grids });
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const { t } = useT();
  if (state === "error") return <Fallback docId={docId} />;
  if (state === "loading" || !parsed) {
    return <div className="grid h-full place-items-center text-[12px] text-muted" title={filename}>{t.documents.spreadsheetLoading}</div>;
  }

  const raw = parsed.grids[active];
  const { grid, clamped } = clampGrid(raw, ROW_CLAMP);
  return (
    <SpreadsheetGrid
      sheetNames={parsed.sheetNames}
      activeSheet={active}
      onSelectSheet={setActive}
      grid={grid}
      clamped={clamped}
      totalRows={raw.rowCount}
      downloadHref={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`}
    />
  );
}
