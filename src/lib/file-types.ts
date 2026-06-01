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
