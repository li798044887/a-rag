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
