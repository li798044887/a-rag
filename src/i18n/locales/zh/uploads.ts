export const uploads = {
  // IngestStepper stage labels
  stageParsing: "解析",
  stageChunking: "分块",
  stageEmbedding: "嵌入",
  stageIndexing: "索引",

  // AttachmentChip — status text
  parsingFile: "{ext} 解析中",
  processing: "处理中…",
  uploading: "上传中… {progress}%",
  queued: "等待中…",
  chunkSuffix: "{n}个块",
  readyDetail: "{type} · {size} · 已索引{n}个块",
  durationSuffix: "{n}秒",
  skippedStatus: "不支持的格式，已跳过",
  errorFallback: "错误",
  retryButton: "重试",

  // aria-label for remove/cancel button
  ariaRemove: "删除",
  ariaCancel: "取消",

  // UserAttachments header
  attachedFiles: "附件",

  // DropOverlay
  dropTitle: "将文件拖放到此处",
  dropSubtitle: "支持文件夹 · PDF · Word · Excel · PowerPoint · CSV · 图片 — 自动索引",

  // QueueGroup summary
  groupDone: "{done}/{target} 完成",
  groupFailed: "{n}个失败",
  groupSkipped: "{n}个已跳过",

  // DocumentsUploadQueue header & summary
  queueHeader: "上传",
  queueProgress: "{done}/{target}",
  queueSkipped: "{n}个已跳过",
  clearAll: "清除",
  hideAll: "全部隐藏",

  // toasts from use-uploads
  toastIndexed: "「{name}」已完成索引",
  toastIndexFailed: "索引失败",
  toastCancelBlocked: "处理中，无法取消",
  toastCancelFailed: "取消失败",
  toastUploadFailed: "上传失败",
  toastNetworkError: "网络错误",
  toastRetryFailed: "重试失败",
  toastSkipped: "已跳过{n}个不支持的格式",
};
