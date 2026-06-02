import type { WorkspaceDict } from "../zh/workspace";

export const workspace: WorkspaceDict = {
  // header — empty phase
  headerNewThread: "新規スレッド",
  headerThreadFallback: "スレッド",

  // header — badges
  badgeCancelled: "キャンセル済",
  badgeRunning: "実行中",

  // header — action buttons
  btnShare: "共有",
  btnExport: "Markdownでエクスポート",
  btnSources: "一次資料 ({n})",

  // header — theme toggle
  toLight: "ライトモードへ",
  toDark: "ダークモードへ",
  themeToggleAriaLabel: "テーマ切替",

  // mobile nav
  openMenuAriaLabel: "メニューを開く",

  // live entry in sidebar
  liveThreadTitle: "新しいスレッド",
  liveThreadUpdated: "たった今",

  // startRun — default query when only files are attached (no text entered)
  attachmentDefaultQuery: "添付ファイルについて要点をまとめて",

  // deleteThread confirm dialog
  deleteThreadTitle: "スレッドを削除しますか？",
  deleteThreadDescWithTitle: "「{title}」は元に戻せません。",
  deleteThreadDescGeneric: "この操作は元に戻せません。",
  deleteThreadConfirm: "削除",
  deleteThreadCancel: "キャンセル",

  // revokeAllSessions confirm dialog
  revokeAllTitle: "すべてのデバイスからサインアウトしますか？",
  revokeAllDesc: "現在のデバイスを含むすべてのセッションが失効します。",
  revokeAllConfirm: "サインアウト",
  revokeAllCancel: "キャンセル",
};
