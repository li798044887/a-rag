import { documents as zhDocuments } from "../zh/documents";

export const documents: typeof zhDocuments = {
  // Modal header
  title: "アップロード文書",
  itemCount: "{count}件",

  // Upload split-button
  uploadButton: "アップロード",
  uploadMethodAriaLabel: "アップロード方法",
  selectFile: "ファイルを選択",
  selectFolder: "フォルダを選択",

  // Close button
  closeAriaLabel: "閉じる",

  // Search
  searchPlaceholder: "ファイル名で検索…",

  // Selection bar
  selectedCount: "{n}件選択中",
  deleting: "削除中…",
  deleteButton: "削除",
  cancelButton: "キャンセル",

  // Filter bar
  filterAll: "すべて",
  filterReady: "索引済み",
  filterError: "エラー",
  filterProcessing: "処理中",
  selectModeButton: "選択",

  // Drag overlay
  dragTitle: "ファイル / フォルダをドロップ",
  dragSubtitle: "そのまま索引化されます",

  // Status labels (badge)
  statusReady: "索引済み",
  statusError: "エラー",
  statusQueued: "待機中",
  statusProcessing: "処理中",
  statusParsing: "解析中",
  statusChunking: "チャンク化",
  statusEmbedding: "埋め込み",
  statusIndexing: "索引化",

  // List
  loadMore: "さらに読み込む",
  emptyList: "該当する文書がありません",

  // Right panel — no selection
  noSelection: "左から文書を選択してください",

  // Preview tabs
  tabOriginal: "原本",
  tabSpreadsheet: "スプレッドシート",
  tabConvertedPdf: "PDF変換原本",
  tabLayout: "レイアウト",
  tabSpan: "Span",
  tabText: "解析テキスト",
  tabHtml: "HTML整形",
  tabImages: "画像",
  tabImagesCount: "画像 ({n})",

  // Preview toolbar actions
  reindex: "再索引",
  downloadOriginal: "原本ダウンロード",
  deleteDocument: "削除",

  // Back button (mobile)
  backToListAriaLabel: "一覧へ戻る",

  // Preview loading / empty states
  loading: "読み込み中…",
  noContent: "表示できる内容がありません",
  noImages: "抽出画像はありません",

  // UnsupportedPreview / Fallback
  unsupportedTitle: "この形式はブラウザでプレビューできません",
  unsupportedDescription: "「解析テキスト」タブで抽出済みの内容を確認するか、原本をダウンロードしてください。",
  unsupportedDownload: "原本をダウンロード",

  // SpreadsheetPreview Fallback
  spreadsheetErrorTitle: "この表計算ファイルを表示できませんでした",
  spreadsheetErrorDescription: "「解析テキスト」タブで抽出済みの内容を確認するか、原本をダウンロードしてください。",
  spreadsheetDownload: "原本をダウンロード",

  // SpreadsheetGrid
  emptySheet: "このシートは空です",
  gridRowsShown: "全 {total} 行中、先頭 {shown} 行を表示。",
  gridDownload: "原本をダウンロード",

  // SpreadsheetPreview loading
  spreadsheetLoading: "読み込み中…",

  // RenderedPdfPreview loading
  pdfConverting: "変換中…",

  // Confirm dialogs
  confirmDeleteTitle: "この文書を削除しますか？",
  confirmDeleteDescription: "「{filename}」と抽出データ・索引を完全に削除します。元に戻せません。",
  confirmDeleteLabel: "削除する",
  confirmBulkDeleteTitle: "選択した{n}件の文書を削除しますか？",
  confirmBulkDeleteDescription: "選択した{n}件の文書と抽出データ・索引を完全に削除します。元に戻せません。",
  confirmBulkDeleteLabel: "削除する",

  // Toasts from use-documents
  toastDeleteFailed: "削除に失敗しました",
  toastDeleted: "文書を削除しました",
  toastBulkDeleted: "{n}件の文書を削除しました",
  toastBulkDeleteFailed: "削除に失敗しました",
  toastRetryFailed: "再索引に失敗しました",
};
