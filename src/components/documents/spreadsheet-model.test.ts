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
  expect(g.cells[1][1]).toBe("12"); // .w 無しのため cell.v フォールバック経路の検証
  expect(g.numeric[1][1]).toBe(true); // 数値セル
  expect(g.numeric[0][0]).toBe(false); // 文字列セル
  expect(g.cells[2][0]).toBeNull(); // 空セル
});

test("sheetToGrid: cell.w（整形済み表示）を cell.v より優先する", () => {
  const ws = XLSX.utils.aoa_to_sheet([[0.5]]);
  (ws["A1"] as { w?: string }).w = "50%";
  const g = sheetToGrid(ws);
  expect(g.cells[0][0]).toBe("50%"); // v(0.5) ではなく w を表示
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
