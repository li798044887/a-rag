// SheetJS ワークシート → 描画用グリッドモデルへの純変換。
// xlsx は型のみ import（import type は実行時に消去されるためメインバンドルへ載らない）。
import type { WorkSheet } from "xlsx";

export interface GridModel {
  rowCount: number;
  colCount: number;
  cells: (string | null)[][]; // [row][col] の表示文字列（空セルは null）
  numeric: boolean[][]; // 右寄せ判定（セルが数値型か）
  merges: { r: number; c: number; rs: number; cs: number }[]; // 左上起点 + span
  colWidths: (number | null)[]; // 列幅(px 目安)。無ければ null
}

const EMPTY: GridModel = {
  rowCount: 0, colCount: 0, cells: [], numeric: [], merges: [], colWidths: [],
};

// 0 始まり列インデックス → Excel 列記号（A, B, …, Z, AA, …）。
export function colLabel(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function decodeCellRef(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { r: 0, c: 0 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

function decodeRange(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const [a, b] = ref.split(":");
  const s = decodeCellRef(a);
  return { s, e: b ? decodeCellRef(b) : s };
}

export function sheetToGrid(ws: WorkSheet): GridModel {
  const ref = ws["!ref"];
  if (!ref) return EMPTY;
  const range = decodeRange(ref);
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;
  const cells: (string | null)[][] = [];
  const numeric: boolean[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const rowCells: (string | null)[] = [];
    const rowNum: boolean[] = [];
    for (let c = 0; c < colCount; c++) {
      const addr = colLabel(range.s.c + c) + (range.s.r + r + 1);
      const cell = (ws as Record<string, { w?: unknown; v?: unknown; t?: string }>)[addr];
      if (cell == null) {
        rowCells.push(null);
        rowNum.push(false);
        continue;
      }
      const text = cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : null;
      rowCells.push(text);
      rowNum.push(cell.t === "n");
    }
    cells.push(rowCells);
    numeric.push(rowNum);
  }
  const merges = (ws["!merges"] ?? []).map((m) => ({
    r: m.s.r - range.s.r,
    c: m.s.c - range.s.c,
    rs: m.e.r - m.s.r + 1,
    cs: m.e.c - m.s.c + 1,
  }));
  const colWidths = Array.from({ length: colCount }, (_, c) => {
    const w = ws["!cols"]?.[range.s.c + c]?.wpx;
    return typeof w === "number" ? w : null;
  });
  return { rowCount, colCount, cells, numeric, merges, colWidths };
}

// 描画行を maxRows でクランプし、結合セルの span も範囲内へ収める。
export function clampGrid(grid: GridModel, maxRows: number): { grid: GridModel; clamped: boolean } {
  if (grid.rowCount <= maxRows) return { grid, clamped: false };
  const cells = grid.cells.slice(0, maxRows);
  const numeric = grid.numeric.slice(0, maxRows);
  const merges = grid.merges
    .filter((m) => m.r < maxRows)
    .map((m) => ({ ...m, rs: Math.min(m.rs, maxRows - m.r) }));
  return { grid: { ...grid, rowCount: maxRows, cells, numeric, merges }, clamped: true };
}
