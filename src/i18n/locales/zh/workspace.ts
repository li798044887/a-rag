export const workspace = {
  // header — empty phase
  headerNewThread: "新建对话",
  headerThreadFallback: "对话",

  // header — badges
  badgeCancelled: "已取消",
  badgeRunning: "执行中",

  // header — action buttons
  btnShare: "分享",
  btnExport: "以 Markdown 格式导出",
  btnSources: "一手资料 ({n})",

  // header — theme toggle
  toLight: "切换到浅色模式",
  toDark: "切换到深色模式",
  themeToggleAriaLabel: "切换主题",

  // mobile nav
  openMenuAriaLabel: "打开菜单",

  // live entry in sidebar
  liveThreadTitle: "新建对话",
  liveThreadUpdated: "刚刚",

  // startRun — default query when only files are attached (no text entered)
  attachmentDefaultQuery: "请帮我总结这些附件的要点",

  // deleteThread confirm dialog
  deleteThreadTitle: "删除此对话？",
  deleteThreadDescWithTitle: "「{title}」将被永久删除，无法恢复。",
  deleteThreadDescGeneric: "此操作无法恢复。",
  deleteThreadConfirm: "删除",
  deleteThreadCancel: "取消",

  // revokeAllSessions confirm dialog
  revokeAllTitle: "从所有设备退出登录？",
  revokeAllDesc: "包括当前设备在内的所有会话均将失效。",
  revokeAllConfirm: "退出登录",
  revokeAllCancel: "取消",
};

export type WorkspaceDict = typeof workspace;
