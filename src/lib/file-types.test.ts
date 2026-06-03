import { expect, test } from "vitest";
import { getTextPreviewKind, isConvertibleToPdf, isImage, isPdf, isSpreadsheet, type TextPreviewKind } from "@/lib/file-types";

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

test("getTextPreviewKind: 種別を拡張子で判定（大小無視）", () => {
  const cases: [string, TextPreviewKind][] = [
    ["README.md", "markdown"],
    ["NOTES.MARKDOWN", "markdown"],
    ["data.json", "json"],
    ["golden_qa.jsonl", "jsonl"],
    ["stream.ndjson", "jsonl"],
    ["notes.txt", "text"],
    ["server.log", "text"],
    ["table.csv", "text"],
    ["table.tsv", "text"],
    ["conf.yaml", "text"],
    ["conf.yml", "text"],
    ["feed.xml", "text"],
  ];
  for (const [name, kind] of cases) {
    expect(getTextPreviewKind(name), name).toBe(kind);
  }
});

test("getTextPreviewKind: テキスト系でない/拡張子なしは null", () => {
  for (const name of ["a.pdf", "a.png", "a.docx", "a.xlsx", "a.ods", "noext", ""]) {
    expect(getTextPreviewKind(name), name).toBeNull();
  }
});

test("isPdf: PDF のみ true（拡張子の大小無視）", () => {
  for (const name of ["a.pdf", "REPORT.PDF"]) expect(isPdf(name), name).toBe(true);
  for (const name of ["a.png", "a.docx", "a.txt", "noext", ""]) expect(isPdf(name), name).toBe(false);
});

test("isImage: ブラウザ表示可能な画像は true（拡張子の大小無視）", () => {
  for (const name of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.avif", "PHOTO.JPG"]) {
    expect(isImage(name), name).toBe(true);
  }
  for (const name of ["a.pdf", "a.docx", "a.txt", "noext", ""]) expect(isImage(name), name).toBe(false);
});
