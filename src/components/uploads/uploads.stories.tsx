import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AttachmentTray, UserAttachments, DropOverlay, DocumentsUploadQueue } from "@/components/uploads/uploads";
import type { StagedFile } from "@/lib/types";

const files: StagedFile[] = [
  { id: "f1", name: "2026Q2_roadmap.pdf", size: 1_820_000, status: "ready", progress: 100, pages: 12, chunks: 48 },
  { id: "f2", name: "meeting_notes.docx", size: 240_000, status: "processing", progress: 64 },
  { id: "f3", name: "metrics.xlsx", size: 96_000, status: "uploading", progress: 28 },
  { id: "f4", name: "broken.pdf", size: 12_000, status: "error", progress: 0, error: "解析に失敗しました" },
];

const folderFiles: StagedFile[] = Array.from({ length: 12 }, (_, i) => ({
  id: `folder-${i}`,
  name: [
    "設計検証報告_凝固管比率_PDF版.pdf",
    "設計検証_凝固管採血比率.docx",
    "設備マニュアル_CVC-8500_真空密封.pdf",
    "設備マニュアル_射出成形機_Engel-e200.pdf",
    "新製品立上げ報告_KM-SST-5.pptx",
    "製品仕様書_KM-SST-5.docx",
  ][i % 6],
  size: 420_000 + i * 10_000,
  status: "uploading",
  progress: 90,
  relPath: `02_研究開発_製品工程/${i + 1}`,
}));

const meta = {
  title: "Uploads",
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** コンポーザー上部の添付トレイ（各種ステータス）。 */
export const Tray: Story = {
  render: () => <AttachmentTray files={files} onRemove={fn()} onRetry={fn()} />,
};

/** 文書管理モーダル内の大量フォルダアップロード。 */
export const DocumentsQueueLargeFolder: Story = {
  render: () => (
    <div className="h-[520px] w-[320px] overflow-hidden border border-divider bg-surface">
      <DocumentsUploadQueue files={folderFiles} onRemove={fn()} onRetry={fn()} onClear={fn()} />
    </div>
  ),
};

/** 送信済みメッセージに紐づく添付の表示。 */
export const InMessage: Story = {
  render: () => <UserAttachments files={files.filter((f) => f.status === "ready")} />,
};

/** ドラッグ&ドロップ時のオーバーレイ。 */
export const Overlay: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <div className="relative h-[360px]">
      <DropOverlay visible />
    </div>
  ),
};
