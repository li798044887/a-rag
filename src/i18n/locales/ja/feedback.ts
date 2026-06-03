import type { feedback as zhFeedback } from "../zh/feedback";

export const feedback: typeof zhFeedback = {
  // toast-viewport — close button
  closeAriaLabel: "閉じる",

  // workspace.tsx — run / agent
  runFailed: "実行に失敗しました",
  runStopped: "実行を停止しました",
  regenerating: "回答を再生成しています",
  regenerateBlocked: "実行中は再生成できません",

  // workspace.tsx — answer actions
  answerCopied: "回答をコピーしました",
  copyFailed: "コピーに失敗しました",

  // workspace.tsx — thread management
  threadRenamed: "スレッド名を変更しました",
  threadRenameFailed: "名前の変更に失敗しました",
  threadDeleted: "スレッドを削除しました",
  threadDeleteFailed: "削除に失敗しました",
  starAdded: "スターを付けました",
  starRemoved: "スターを外しました",
  starUpdateFailed: "スターの更新に失敗しました",

  // workspace.tsx — project
  projectComingSoon: "プロジェクト機能は近日公開予定です",

  // workspace.tsx — source / export
  sourceDownloaded: "「{filename}」をダウンロードしました",
  popupBlocked: "ポップアップがブロックされています",
  exportEmpty: "エクスポートするスレッドがありません",
  exported: "スレッドをMarkdownでエクスポートしました",

  // workspace.tsx — feedback
  feedbackSent: "フィードバックを送信しました",
  feedbackImprovement: "改善要望を受け付けました",

  // workspace.tsx — scope
  scopeChanged: "検索範囲: {label}",

  // workspace.tsx — share
  linkCopied: "共有リンクをコピーしました",
  linkCopyFailed: "コピーに失敗しました",

  // workspace.tsx — model / settings
  modelSwitched: "{label} に切り替えました",
  sessionSaved: "セッションを保存します",
  sessionSaveDisabled: "セッション保存を解除しました",
  sessionUpdateFailed: "セッション設定の更新に失敗しました",
  signedOutAll: "全デバイスからサインアウトしました",
  signOutFailed: "サインアウトに失敗しました",
  nameUpdated: "表示名を更新しました",
  nameUpdateFailed: "表示名の更新に失敗しました",
};
