import { expect, test } from "vitest";
import { isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";

test("isConvertibleToPdf: Office 形式は true（拡張子の大小無視）", () => {
  for (const name of [
    "report.docx", "old.doc", "data.xlsx", "old.xls", "deck.pptx",
    "old.ppt", "notes.odt", "calc.ods", "slides.odp", "memo.rtf",
    "REPORT.XLSX",
  ]) {
    expect(isConvertibleToPdf(name), name).toBe(true);
  }
});

test("isConvertibleToPdf: 既にプレビュー可能/対象外は false", () => {
  for (const name of ["a.pdf", "a.png", "a.jpg", "a.txt", "a.md", "a.csv", "noext"]) {
    expect(isConvertibleToPdf(name), name).toBe(false);
  }
});

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
