import { uploads as zhUploads } from "../zh/uploads";

export const uploads: typeof zhUploads = {
  // IngestStepper stage labels
  stageParsing: "解析",
  stageChunking: "チャンク化",
  stageEmbedding: "埋め込み",
  stageIndexing: "索引化",

  // AttachmentChip — status text
  parsingFile: "{ext} 解析中",
  processing: "処理中…",
  uploading: "アップロード中… {progress}%",
  queued: "待機中…",
  chunkSuffix: "{n}チャンク",
  readyDetail: "{type} · {size} · {n}件のチャンクを索引化",
  durationSuffix: "{n}秒",
  skippedStatus: "未対応の形式のためスキップ",
  errorFallback: "エラー",
  retryButton: "再試行",

  // aria-label for remove/cancel button
  ariaRemove: "削除",
  ariaCancel: "取り消し",

  // UserAttachments header
  attachedFiles: "添付されたファイル",

  // DropOverlay
  dropTitle: "ファイルをここにドロップ",
  dropSubtitle: "フォルダもOK · PDF · Word · Excel · PowerPoint · CSV · 画像 — 自動的に索引化されます",

  // QueueGroup summary
  groupDone: "{done}/{target} 完了",
  groupFailed: "{n}失敗",
  groupSkipped: "{n}スキップ",

  // DocumentsUploadQueue header & summary
  queueHeader: "アップロード",
  queueProgress: "{done}/{target}",
  queueSkipped: "{n}スキップ",
  clearAll: "クリア",
  hideAll: "すべて非表示",

  // toasts from use-uploads
  toastIndexed: "「{name}」を索引化しました",
  toastIndexFailed: "索引化に失敗しました",
  toastCancelBlocked: "処理中のため取り消せません",
  toastCancelFailed: "取り消しに失敗しました",
  toastUploadFailed: "アップロードに失敗しました",
  toastNetworkError: "ネットワークエラー",
  toastRetryFailed: "再試行に失敗しました",
  toastSkipped: "未対応の形式 {n}件をスキップしました",
};
