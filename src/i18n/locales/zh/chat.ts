export const chat = {
  // empty-state
  greetingMorning: "早上好",
  greetingDay: "你好",
  greetingEvening: "晚上好",
  greetingConnector: "，",
  greetingSuffix: "",
  metaIndexed: "文档已索引",
  metaConnected: "数据源已连接",
  metaLastSync: "最近同步",
  leadText: "横跨公司内部的会议纪要 · Wiki · Slack · DB 进行检索。输入问题，或从下方选择。",

  // messages
  thinking: "思考中…",
  dateToday: "今天",
  dateYesterday: "昨天",
  sentAt: "发送于 {time}",

  // agent-activity
  agentRunning: "智能体执行中…",
  agentDone: "智能体执行",
  stepUnit: "步",

  // composer
  placeholderRunning: "智能体执行中…",
  placeholderIdle: "输入问题，或拖入文件提问…",
  attachTitle: "添加文件 (PDF/Word/Excel 等)",
  scopeTitle: "选择检索范围",
  stopTitle: "停止执行",
  pendingSubmitTitle: "请等待上传完成",
  cancelHintText: " 取消执行",
  pendingHint: "请等待上传完成…",
  hintSend: " 发送",
  hintNewline: " 换行",
  hintDrop: "拖放文件",
  hintNewThread: " 新建会话",

  // answer-footer
  sourcesTitle: "查看本轮一手资料",
  copyTitle: "复制",
  regenerateTitle: "重新生成",
  feedbackUpTitle: "好评",
  feedbackDownTitle: "差评",
  cancelledNotice: "执行已被用户停止。",
  retryRun: "重新执行",

  // cited-text
  imageLoadError: "［无法加载图片{alt}］",
  openCitation: "打开引用 {n}",

  // scope-picker
  scopeHeader: "检索范围",
  scopePresets: "预设",
  scopeCustom: "自定义",
  noFilesUploaded: "尚未上传文件",
  customSourcesLabel: "{n}个数据源",
  customSourcesSelected: "已选择 {n} 个数据源",
  applyScope: "应用",

  // tool-steps
  statusRunning: "执行中",
  statusDone: "完成",
  statusPending: "等待中",
  statusError: "错误",
  sourceLabel: "出处：",
  documentLabel: "文档：",
  inputTokens: "输入 token",
  outputTokens: "输出 token",
  totalTokens: "合计 token",
  cacheTokens: "缓存读取",
  noCandidates: "无候选",
  expandCount: "扩展数量",
  sectionModel: "模型",
  sectionInput: "输入",
  sectionUsedTokens: "使用 token",
  sectionOutput: "输出",
  sectionDraft: "修订前回答",
  sectionUnsupported: "无依据主张",
  sectionRevised: "修订后回答",
  allGrounded: "全部主张均有出处支撑",
  noCheckableClaims: "没有可校验的事实主张",
  moreItems: "… 其他 {n} 条",
  stepCancelled: "已取消",
};
