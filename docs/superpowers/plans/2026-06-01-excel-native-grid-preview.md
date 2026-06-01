# Excel ネイティブグリッド・プレビュー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アップロード文書モーダルで Excel（.xlsx/.xls/.ods）を PDF 化せず、シートタブ・行番号/列記号ヘッダ・セル結合を保った Excel 風グリッドでプレビューできるようにする。

**Architecture:** 原本 blob を既存 `GET /api/documents/[id]/raw` から取得し、クライアント側で SheetJS（`xlsx`）を**動的 import** してパースする。ロジックは純関数 `spreadsheet-model.ts`（xlsx ランタイム非依存）、表示は純粋な `SpreadsheetGrid`、データ取得は `SpreadsheetPreview` に三分割し、それぞれ独立にテストする。サーバ・rag イメージは変更しない。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / SheetJS `xlsx@0.18.5`（動的 import）/ Vitest（node ユニット）/ Storybook 10。

参照仕様: `docs/superpowers/specs/2026-06-01-excel-native-grid-preview-design.md`

---

## ファイル構成

- 新規 `src/components/documents/spreadsheet-model.ts` — 純ロジック（`GridModel`, `sheetToGrid`, `clampGrid`, `colLabel`）。xlsx ランタイム非依存（型のみ `import type`）。
- 新規 `src/components/documents/spreadsheet-model.test.ts` — 上記の vitest ユニットテスト。
- 新規 `src/components/documents/spreadsheet-grid.tsx` — 表示専用 `SpreadsheetGrid` コンポーネント（fetch なし）。

> 命名注: ロジックは `spreadsheet-model.ts`、表示は `spreadsheet-grid.tsx` と**基底名を分ける**。同名異拡張子にすると拡張子なし import が `.ts` 側へ解決され、`.tsx` の `SpreadsheetGrid` を import できなくなるため。
- 新規 `src/components/documents/spreadsheet-grid.stories.tsx` — Storybook ストーリー。
- 新規 `src/components/documents/spreadsheet-preview.tsx` — データ取得＋動的 import の `SpreadsheetPreview`。
- 変更 `src/lib/file-types.ts` — `isSpreadsheet(name)` ヘルパ追加。
- 変更 `src/lib/file-types.test.ts` — `isSpreadsheet` のテスト追加。
- 変更 `src/components/documents/documents-modal.tsx` — 分岐とタブラベル。
- 変更 `package.json` / `pnpm-lock.yaml` — `xlsx` 依存追加。

---

### Task 1: `xlsx` 依存の追加

**Files:**
- Modify: `package.json`（`dependencies`）, `pnpm-lock.yaml`

- [ ] **Step 1: 依存を追加**

Run:
```bash
pnpm add xlsx@0.18.5
```
Expected: `dependencies` に `"xlsx": "0.18.5"` が追加され、`pnpm-lock.yaml` が更新される。

- [ ] **Step 2: インストール確認**

Run:
```bash
node -e "console.log(require('xlsx/package.json').version)"
```
Expected: `0.18.5` と出力。

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: Excel プレビュー用に xlsx(SheetJS) を追加"
```

---

### Task 2: `isSpreadsheet` ヘルパ

`.xlsx/.xls/.ods` を SheetJS でネイティブ描画する対象として判定する。

**Files:**
- Modify: `src/lib/file-types.ts`
- Test: `src/lib/file-types.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/file-types.test.ts` の先頭 import を更新し、末尾にテストを追加する。

import 行を次に置き換え:
```ts
import { isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
```

ファイル末尾に追加:
```ts
test("isSpreadsheet: 表計算形式は true（拡張子の大小無視）", () => {
  for (const name of ["data.xlsx", "old.xls", "calc.ods", "DATA.XLSX"]) {
    expect(isSpreadsheet(name), name).toBe(true);
  }
});

test("isSpreadsheet: それ以外は false", () => {
  for (const name of ["a.csv", "a.docx", "a.pdf", "a.png", "noext"]) {
    expect(isSpreadsheet(name), name).toBe(false);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run --project unit src/lib/file-types.test.ts`
Expected: FAIL（`isSpreadsheet` が export されていない）。

- [ ] **Step 3: 実装を追加**

`src/lib/file-types.ts` の末尾（`isConvertibleToPdf` の後）に追加:
```ts
// SheetJS でネイティブ描画する表計算形式（拡張子・小文字）。CSV は解析テキストで足りるため対象外。
const SPREADSHEET_EXTS = new Set(["xlsx", "xls", "ods"]);

// 原本をブラウザ上で Excel 風グリッド描画できる形式かを拡張子で判定する。
export function isSpreadsheet(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return name.includes(".") && SPREADSHEET_EXTS.has(ext);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run --project unit src/lib/file-types.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/file-types.ts src/lib/file-types.test.ts
git commit -m "feat: 表計算形式を判定する isSpreadsheet を追加"
```

---

### Task 3: グリッドモデル純ロジック `spreadsheet-model.ts`

SheetJS ワークシートを描画用グリッドモデルへ変換する純関数群。xlsx の**ランタイム import は禁止**（型のみ `import type`）。A1 アドレス解決は自前の軽量実装にし、メインバンドルから xlsx を排除する。

**Files:**
- Create: `src/components/documents/spreadsheet-model.ts`
- Test: `src/components/documents/spreadsheet-model.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/documents/spreadsheet-model.test.ts`:
```ts
import { expect, test } from "vitest";
import * as XLSX from "xlsx";
import { colLabel, sheetToGrid, clampGrid } from "@/components/documents/spreadsheet-model";

test("colLabel: 0始まりインデックスを Excel 列記号へ", () => {
  expect(colLabel(0)).toBe("A");
  expect(colLabel(25)).toBe("Z");
  expect(colLabel(26)).toBe("AA");
  expect(colLabel(27)).toBe("AB");
});

test("sheetToGrid: 値・整形済み表示・数値判定・空セル", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["日付", "数量"],
    ["2025-03-17", 12],
    [null, 8],
  ]);
  const g = sheetToGrid(ws);
  expect(g.rowCount).toBe(3);
  expect(g.colCount).toBe(2);
  expect(g.cells[0]).toEqual(["日付", "数量"]);
  expect(g.cells[1][1]).toBe("12"); // cell.w（整形済み）
  expect(g.numeric[1][1]).toBe(true); // 数値セル
  expect(g.numeric[0][0]).toBe(false); // 文字列セル
  expect(g.cells[2][0]).toBeNull(); // 空セル
});

test("sheetToGrid: !merges を左上起点 + span へ正規化", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["見出し", null],
    ["a", "b"],
  ]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  const g = sheetToGrid(ws);
  expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
});

test("sheetToGrid: 空シート（!ref 無し）は空モデル", () => {
  const g = sheetToGrid({} as XLSX.WorkSheet);
  expect(g.rowCount).toBe(0);
  expect(g.colCount).toBe(0);
  expect(g.cells).toEqual([]);
});

test("clampGrid: 上限以下はそのまま", () => {
  const ws = XLSX.utils.aoa_to_sheet([["a"], ["b"]]);
  const { grid, clamped } = clampGrid(sheetToGrid(ws), 10);
  expect(clamped).toBe(false);
  expect(grid.rowCount).toBe(2);
});

test("clampGrid: 上限超過は行を切り詰め、結合も追従", () => {
  const ws = XLSX.utils.aoa_to_sheet([["a"], ["b"], ["c"], ["d"]]);
  ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }]; // 行2-4 を結合
  const { grid, clamped } = clampGrid(sheetToGrid(ws), 2);
  expect(clamped).toBe(true);
  expect(grid.rowCount).toBe(2);
  expect(grid.cells.length).toBe(2);
  expect(grid.merges).toEqual([{ r: 1, c: 0, rs: 1, cs: 1 }]); // rs を 1 にクランプ
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run --project unit src/components/documents/spreadsheet-model.test.ts`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: 実装を書く**

`src/components/documents/spreadsheet-model.ts`:
```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run --project unit src/components/documents/spreadsheet-model.test.ts`
Expected: PASS（6 件）。

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/spreadsheet-model.ts src/components/documents/spreadsheet-model.test.ts
git commit -m "feat: ワークシートをグリッドモデル化する純ロジックを追加"
```

---

### Task 4: 表示専用 `SpreadsheetGrid` コンポーネント

グリッドモデルを Excel 風テーブル＋シートタブで描画する純粋（fetch なし）コンポーネント。

**Files:**
- Create: `src/components/documents/spreadsheet-grid.tsx`

- [ ] **Step 1: コンポーネントを書く**

`src/components/documents/spreadsheet-grid.tsx`:
```tsx
"use client";

import { cn } from "@/lib/utils";
import { colLabel, type GridModel } from "@/components/documents/spreadsheet-model";

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
          <div className="grid h-full place-items-center text-[12px] text-muted">このシートは空です</div>
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
          全 {totalRows.toLocaleString()} 行中、先頭 {grid.rowCount.toLocaleString()} 行を表示。
          <a href={downloadHref} className="ml-1 font-medium text-accent hover:underline">原本をダウンロード</a>
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
```

注: 表示 `spreadsheet-grid.tsx` はロジック `spreadsheet-model.ts` から `colLabel` / `GridModel` を import する（基底名が異なるため解決の曖昧さは無い）。

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/spreadsheet-grid.tsx
git commit -m "feat: Excel風グリッド表示コンポーネント SpreadsheetGrid を追加"
```

---

### Task 5: `SpreadsheetGrid` の Storybook ストーリー

**Files:**
- Create: `src/components/documents/spreadsheet-grid.stories.tsx`

- [ ] **Step 1: ストーリーを書く**

`src/components/documents/spreadsheet-grid.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { SpreadsheetGrid } from "@/components/documents/spreadsheet-grid";
import type { GridModel } from "@/components/documents/spreadsheet-model";

function makeGrid(rows: (string | null)[][]): GridModel {
  return {
    rowCount: rows.length,
    colCount: rows[0]?.length ?? 0,
    cells: rows,
    numeric: rows.map((row) => row.map((v) => v != null && /^[\d,.-]+$/.test(v))),
    merges: [],
    colWidths: rows[0]?.map(() => null) ?? [],
  };
}

const baseGrid = makeGrid([
  ["日期", "时间"],
  ["2025-03-17", "09:00-10:00"],
  ["2025-03-18", "14:00-16:00"],
  ["2025-03-21", "全天"],
]);

const meta = {
  title: "Documents/SpreadsheetGrid",
  component: SpreadsheetGrid,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    sheetNames: ["2025Q1", "2025Q2"],
    activeSheet: 0,
    onSelectSheet: fn(),
    grid: baseGrid,
    clamped: false,
    totalRows: 4,
    downloadHref: "#",
  },
} satisfies Meta<typeof SpreadsheetGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    // 行番号・列記号ヘッダとシートタブが描画される。
    await expect(canvas.getByText("日期")).toBeInTheDocument();
    await canvas.getByRole("button", { name: "2025Q2" }).click();
    await expect(args.onSelectSheet).toHaveBeenCalledWith(1);
  },
};

/** セル結合（見出しを 2 列にまたがって表示）。 */
export const Merged: Story = {
  args: {
    grid: {
      ...makeGrid([
        ["月次予定", null],
        ["2025-03-17", "09:00-10:00"],
      ]),
      merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
    },
    sheetNames: ["Sheet1"],
    totalRows: 2,
  },
  play: async ({ canvas }) => {
    const cell = within(canvas.getByText("月次予定").closest("td")!);
    await expect(cell).toBeTruthy();
  },
};

/** 行クランプの注記が出るケース。 */
export const Clamped: Story = {
  args: {
    clamped: true,
    totalRows: 5000,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/先頭/)).toBeInTheDocument();
  },
};
```

- [ ] **Step 2: ストーリーテストを実行**

Run: `pnpm vitest run --project storybook -t "SpreadsheetGrid"`
Expected: PASS（Default / Merged / Clamped）。

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/spreadsheet-grid.stories.tsx
git commit -m "test: SpreadsheetGrid の Storybook ストーリーを追加"
```

---

### Task 6: データ取得 `SpreadsheetPreview`

原本 blob を取得 → xlsx を動的 import → パース → `SpreadsheetGrid` を描画する。`docId` ごとに key で再マウントされる前提。

**Files:**
- Create: `src/components/documents/spreadsheet-preview.tsx`

- [ ] **Step 1: コンポーネントを書く**

`src/components/documents/spreadsheet-preview.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { SpreadsheetGrid } from "@/components/documents/spreadsheet-grid";
import { clampGrid, sheetToGrid, type GridModel } from "@/components/documents/spreadsheet-model";

const ROW_CLAMP = 2000;

interface Parsed {
  sheetNames: string[];
  grids: GridModel[]; // シート毎の素のグリッド（クランプ前）
}

/** プレビュー不可フォールバック（原本ダウンロード導線）。documents-modal と同等。 */
function Fallback({ docId }: { docId: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">この表計算ファイルを表示できませんでした</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">「解析テキスト」タブで抽出済みの内容を確認するか、原本をダウンロードしてください。</div>
        <a href={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`} className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2">原本をダウンロード</a>
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

  if (state === "error") return <Fallback docId={docId} />;
  if (state === "loading" || !parsed) {
    return <div className="grid h-full place-items-center text-[12px] text-muted" title={filename}>読み込み中…</div>;
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
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/components/documents/spreadsheet-preview.tsx
git commit -m "feat: 原本xlsxを動的importでパースする SpreadsheetPreview を追加"
```

---

### Task 7: モーダルへの組み込み

`documents-modal.tsx` で spreadsheet を判定し、「PDF変換原本」の代わりに `SpreadsheetPreview` を表示する。

**Files:**
- Modify: `src/components/documents/documents-modal.tsx`

- [ ] **Step 1: import を追加**

`src/components/documents/documents-modal.tsx` の import 群を更新する。

`getFileMeta, isConvertibleToPdf` の import 行を:
```ts
import { getFileMeta, isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
```
に置き換え、`DocumentsUploadQueue` の import の下あたりに追加:
```ts
import { SpreadsheetPreview } from "@/components/documents/spreadsheet-preview";
```

- [ ] **Step 2: 判定変数を追加**

`const isConvertible = selected ? isConvertibleToPdf(selected.filename) : false;` の直後に追加:
```ts
// 表計算は PDF 化せず Excel 風グリッドでネイティブ描画する（PDF/画像/Office PDF 変換より優先）。
const isSheet = selected ? isSpreadsheet(selected.filename) : false;
```

- [ ] **Step 3: タブラベルを更新**

タブ配列のラベル式 `["pdf", isConvertible ? "PDF変換原本" : "原本"]` を:
```ts
["pdf", isSheet ? "スプレッドシート" : isConvertible ? "PDF変換原本" : "原本"]
```
に変更する。

- [ ] **Step 4: 本文分岐を更新**

`tab === "pdf"` の本文分岐を次のように変更する。

(a) spreadsheet 用の枝を、Office PDF 変換の枝の**前**に追加:
```tsx
{tab === "pdf" && !isPdf && !isImage && isSheet && (
  <div className="h-full p-3">
    <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">
      <SpreadsheetPreview key={selected.id} docId={selected.id} filename={selected.filename} />
    </div>
  </div>
)}
```

(b) 既存の Office PDF 変換の枝の条件に `!isSheet` を追加:
```tsx
{tab === "pdf" && !isPdf && !isImage && !isSheet && isConvertible && (
  <div className="h-full p-3">
    <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">
      <RenderedPdfPreview key={selected.id} docId={selected.id} filename={selected.filename} />
    </div>
  </div>
)}
```

(c) 既存の非対応フォールバックの枝の条件に `!isSheet` を追加:
```tsx
{tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && (
  <UnsupportedPreview docId={selected.id} />
)}
```

- [ ] **Step 5: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/components/documents/documents-modal.tsx
git commit -m "feat: Excel原本を SpreadsheetPreview でネイティブ表示するようモーダルを接続"
```

---

### Task 8: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全ユニットテスト**

Run: `pnpm vitest run --project unit`
Expected: 全 PASS（既存 + Task 2/3 の新規）。

- [ ] **Step 2: Storybook テスト**

Run: `pnpm vitest run --project storybook -t "SpreadsheetGrid"`
Expected: PASS。

- [ ] **Step 3: Lint と型**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint src/components/documents src/lib/file-types.ts`
Expected: エラーなし。

- [ ] **Step 4: 手動確認（任意）**

`pnpm dev` で起動し、文書モーダルで `.xlsx` を選択 → 「スプレッドシート」タブに行番号/列記号ヘッダ・シートタブ付きグリッドが表示され、複数シートを切替できることを確認する。`.docx`/`.pptx` は従来どおり「PDF変換原本」で表示されることも確認する。

---

## 完了条件

- `.xlsx/.xls/.ods` 文書のプレビューが、行番号・列記号ヘッダ、シートタブ、セル結合を保った Excel 風グリッドで表示される。
- 巨大シートは 2,000 行でクランプされ、ダウンロード導線付き注記が出る。
- パース失敗・空ブックはダウンロード導線へフォールバックする。
- 既存の PDF/画像/その他 Office（PDF 変換）プレビューは従来どおり動作する。
- サーバ・rag イメージは無変更。`xlsx` はメインバンドルに載らず動的 import される。
