export const documents = {
  // Modal header
  title: "上传文档",
  itemCount: "{count}件",
  processingEngine: "解析引擎（GPU 时索引更快、支持图表解析）",

  // Upload split-button
  uploadButton: "上传",
  uploadMethodAriaLabel: "上传方式",
  selectFile: "选择文件",
  selectFolder: "选择文件夹",

  // Close button
  closeAriaLabel: "关闭",

  // Search
  searchPlaceholder: "按文件名搜索…",

  // Selection bar
  selectedCount: "已选{n}件",
  deleting: "删除中…",
  deleteButton: "删除",
  cancelButton: "取消",

  // Filter bar
  filterAll: "全部",
  filterReady: "已索引",
  filterError: "错误",
  filterProcessing: "处理中",
  selectModeButton: "选择",

  // Drag overlay
  dragTitle: "将文件/文件夹拖放到此处",
  dragSubtitle: "将自动索引",

  // Status labels (badge)
  statusReady: "已索引",
  statusError: "错误",
  statusQueued: "等待中",
  statusProcessing: "处理中",
  statusParsing: "解析中",
  statusChunking: "分块中",
  statusEmbedding: "嵌入中",
  statusIndexing: "索引中",

  // List
  loadMore: "加载更多",
  emptyList: "没有符合条件的文档",

  // Right panel — no selection
  noSelection: "请从左侧选择文档",

  // Preview tabs
  tabOriginal: "原文件",
  tabSpreadsheet: "表格",
  tabConvertedPdf: "原文档转换PDF",
  tabLayout: "布局",
  tabText: "解析文本",
  tabRich: "格式化显示",
  tabHtml: "HTML格式",
  previewEmpty: "无可显示的内容",
  jsonParseError: "无法解析为 JSON，将显示原文。",
  rawTruncated: "文件较大，仅显示开头部分。完整内容请通过「下载原文件」获取。",
  tabImages: "图片",
  tabImagesCount: "图片 ({n})",

  // Preview toolbar actions
  reindex: "重新索引",
  downloadOriginal: "下载原文件",
  deleteDocument: "删除",

  // Back button (mobile)
  backToListAriaLabel: "返回列表",

  // Preview loading / empty states
  loading: "加载中…",
  noContent: "无可显示的内容",
  noImages: "没有提取到图片",

  // UnsupportedPreview / Fallback
  unsupportedTitle: "此格式无法在浏览器中预览",
  unsupportedDescription: '请在"解析文本"标签页查看提取内容，或下载原文件。',
  unsupportedDownload: "下载原文件",

  // MissingOriginalPreview（源文件が削除済み = /raw 404）
  missingTitle: "源文件已删除或不可用",
  missingDescription: '该文件已被删除，无法预览或下载。可在"解析文本"标签页查看已提取的引用文本。',

  // SpreadsheetPreview Fallback
  spreadsheetErrorTitle: "无法显示该表格文件",
  spreadsheetErrorDescription: '请在"解析文本"标签页查看提取内容，或下载原文件。',
  spreadsheetDownload: "下载原文件",

  // SpreadsheetGrid
  emptySheet: "此工作表为空",
  gridRowsShown: "共 {total} 行，显示前 {shown} 行。",
  gridDownload: "下载原文件",

  // SpreadsheetPreview loading
  spreadsheetLoading: "加载中…",

  // RenderedPdfPreview loading
  pdfConverting: "转换中…",

  // Confirm dialogs
  confirmDeleteTitle: "确定要删除此文档吗？",
  confirmDeleteDescription: "将彻底删除「{filename}」及其提取数据和索引，无法恢复。",
  confirmDeleteLabel: "删除",
  confirmBulkDeleteTitle: "确定要删除所选的{n}件文档吗？",
  confirmBulkDeleteDescription: "将彻底删除所选的{n}件文档及其提取数据和索引，无法恢复。",
  confirmBulkDeleteLabel: "删除",

  // Toasts from use-documents
  toastDeleteFailed: "删除失败",
  toastDeleted: "已删除文档",
  toastBulkDeleted: "已删除{n}件文档",
  toastBulkDeleteFailed: "删除失败",
  toastRetryFailed: "重新索引失败",
};
