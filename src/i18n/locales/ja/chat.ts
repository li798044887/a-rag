import { chat as zhChat } from "../zh/chat";

export const chat: typeof zhChat = {
  // empty-state
  greetingMorning: "おはようございます",
  greetingDay: "こんにちは",
  greetingEvening: "こんばんは",
  greetingConnector: "、",
  greetingSuffix: " さん",
  metaIndexed: "ドキュメント索引中",
  metaConnected: "データソース接続中",
  metaLastSync: "最終同期",
  leadText: "社内の議事録 · Wiki · Slack · DB を横断して調べます。質問を入力するか、下から選んでください。",

  // messages
  thinking: "考え中…",
  dateToday: "今日",
  dateYesterday: "昨日",
  sentAt: "{time} に送信",

  // agent-activity
  agentRunning: "エージェント実行中…",
  agentDone: "エージェント実行",
  stepUnit: "ステップ",

  // composer
  placeholderRunning: "エージェントが実行中です…",
  placeholderIdle: "質問するか、ファイルをドロップして訪ねてください…",
  attachTitle: "ファイルを添付 (PDF/Word/Excelなど)",
  scopeTitle: "検索範囲を選択",
  stopTitle: "実行を停止",
  pendingSubmitTitle: "アップロード完了までお待ちください",
  cancelHintText: "で実行をキャンセル",
  pendingHint: "アップロード完了までお待ちください…",
  hintSend: "で送信",
  hintNewline: "で改行",
  hintDrop: "ファイルをドラッグ&ドロップ",
  hintNewThread: "で新規スレッド",

  // answer-footer
  sourcesTitle: "このターンの一次資料を表示",
  copyTitle: "コピー",
  regenerateTitle: "再生成",
  feedbackUpTitle: "良い回答",
  feedbackDownTitle: "悪い回答",
  cancelledNotice: "ユーザーにより実行が停止されました。",
  retryRun: "もう一度実行",

  // cited-text
  imageLoadError: "［画像を読み込めませんでした{alt}］",
  openCitation: "引用 {n} を開く",

  // scope-picker
  scopeHeader: "検索範囲",
  scopePresets: "プリセット",
  scopeCustom: "カスタム",
  noFilesUploaded: "ファイルがアップロードされていません",
  customSourcesLabel: "{n}ソース",
  customSourcesSelected: "{n}個のソースを選択中",
  applyScope: "適用",

  // tool-steps
  statusRunning: "実行中",
  statusDone: "完了",
  statusPending: "待機中",
  statusError: "エラー",
  sourceLabel: "出典: ",
  documentLabel: "文書: ",
  inputTokens: "入力トークン",
  outputTokens: "出力トークン",
  totalTokens: "合計トークン",
  cacheTokens: "キャッシュ読込",
  noCandidates: "候補なし",
  expandCount: "拡張件数",
  sectionModel: "モデル",
  sectionInput: "入力",
  sectionUsedTokens: "使用トークン",
  sectionOutput: "出力",
  sectionDraft: "訂正前の回答",
  sectionUnsupported: "未裏付けの主張",
  sectionRevised: "訂正後の回答",
  allGrounded: "全主張が出典で裏付け済み",
  noCheckableClaims: "検証対象の事実主張はありません",
  moreItems: "… 他 {n} 件",
  stepCancelled: "キャンセルされました",
};
