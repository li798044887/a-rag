import type { IconName } from "@/components/icons";

interface FileMeta {
  iconName: IconName;
  color: string;
  label: string;
}

const FILE_TYPES: Record<string, FileMeta> = {
  pdf: { iconName: "filePdf", color: "#D9534F", label: "PDF" },
  docx: { iconName: "fileDoc", color: "#2B579A", label: "Word" },
  doc: { iconName: "fileDoc", color: "#2B579A", label: "Word" },
  xlsx: { iconName: "fileSheet", color: "#1F7244", label: "Excel" },
  xls: { iconName: "fileSheet", color: "#1F7244", label: "Excel" },
  csv: { iconName: "fileSheet", color: "#1F7244", label: "CSV" },
  pptx: { iconName: "fileSlide", color: "#D24726", label: "PowerPoint" },
  ppt: { iconName: "fileSlide", color: "#D24726", label: "PowerPoint" },
  txt: { iconName: "fileText", color: "#6B6B6B", label: "Text" },
  md: { iconName: "fileText", color: "#6B6B6B", label: "Markdown" },
  json: { iconName: "fileCode", color: "#7A5AE0", label: "JSON" },
  png: { iconName: "fileImage", color: "#3D7EE6", label: "PNG" },
  jpg: { iconName: "fileImage", color: "#3D7EE6", label: "JPEG" },
  jpeg: { iconName: "fileImage", color: "#3D7EE6", label: "JPEG" },
};

export function getFileMeta(name: string): FileMeta {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return (
    FILE_TYPES[ext] || {
      iconName: "fileGeneric",
      color: "#6B6B6B",
      label: ext.toUpperCase() || "FILE",
    }
  );
}

// rag 側 CONVERTIBLE_EXTS（documents_service.py）と一致させること。
// LibreOffice→PDF 変換でブラウザプレビューできる Office 系形式。
const CONVERTIBLE_EXTS = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
]);

// 原本をサーバ側で PDF 変換してプレビューできる形式かを拡張子で判定する。
export function isConvertibleToPdf(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return name.includes(".") && CONVERTIBLE_EXTS.has(ext);
}

// SheetJS でネイティブ描画する表計算形式（拡張子・小文字）。CSV は解析テキストで足りるため対象外。
const SPREADSHEET_EXTS = new Set(["xlsx", "xls", "ods"]);

// 原本をブラウザ上で Excel 風グリッド描画できる形式かを拡張子で判定する。
export function isSpreadsheet(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return name.includes(".") && SPREADSHEET_EXTS.has(ext);
}

export type TextPreviewKind = "markdown" | "json" | "jsonl" | "text";

// 整形プレビュー対象のテキスト系拡張子 → 種別。表計算(xlsx/xls/ods)は isSpreadsheet が優先するため除外。
const TEXT_PREVIEW_KINDS: Record<string, TextPreviewKind> = {
  md: "markdown", markdown: "markdown",
  json: "json",
  jsonl: "jsonl", ndjson: "jsonl",
  txt: "text", log: "text", csv: "text", tsv: "text",
  yaml: "text", yml: "text", xml: "text",
};

// 文書をブラウザ上で整形表示できるテキスト系種別を拡張子で判定する。非対象は null。
export function getTextPreviewKind(name: string): TextPreviewKind | null {
  if (!name.includes(".")) return null;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return TEXT_PREVIEW_KINDS[ext] ?? null;
}
