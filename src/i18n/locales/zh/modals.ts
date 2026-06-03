export const modals = {
  // 语言切换（已有，保留）
  languageLabel: "语言",
  languageHint: "界面与回答语言",
  languageSwitchTitle: "切换语言",
  languageSwitchDesc: "切换语言会刷新页面，确定继续吗？",

  // ===== settings-modal =====
  // 侧边栏标题
  settingsTitle: "设置",

  // 导航标签 / 面板标题
  navModel: "模型",
  navSources: "数据源",
  navAgent: "智能体行为",
  navAppearance: "外观",
  navSecurity: "安全",
  navAccount: "账户",

  // 模型面板
  modelPrivacyNote:
    "提示词与回答会保存到日志，但不会被模型提供商用于任何用途或训练。",

  // 智能体面板
  agentMaxStepsLabel: "最大步骤数",
  agentMaxStepsHint: "智能体最多可调用工具的次数",
  agentParallelToolsLabel: "并行工具执行",
  agentParallelToolsHint: "同时运行的工具数量",
  agentRequireCitationsLabel: "强制引用",
  agentRequireCitationsHint: "要求回答中每条事实都附带引用",
  agentAdmitUnknownLabel: '对未知内容回答"不知道"',
  agentTopKLabel: "返回片段数",
  agentTopKHint: "重排序后传入回答的最终片段数（top_k）",
  agentCandidateKLabel: "候选池大小",
  agentCandidateKHint: "向量/关键词检索各自的候选数量（candidate_k），越大召回越全但越慢",

  // 外观面板
  appearanceDarkModeLabel: "深色模式",
  appearanceDarkModeHint: "切换到对眼睛友好的深色配色",
  appearanceAccentColorLabel: "强调色",
  appearanceToolViewLabel: "工具执行显示",
  appearanceToolViewHint: "智能体工具调用的展示方式",
  appearanceToolViewCard: "卡片（折叠）",
  appearanceToolViewTimeline: "时间轴",
  appearanceToolViewLog: "终端风格日志",
  appearanceDensityLabel: "信息密度",
  appearanceDensityCompact: "紧凑",
  appearanceDensityComfy: "舒适",
  appearanceCitationStyleLabel: "引用样式",
  appearanceCitationStyleNumbered: "上标数字",
  appearanceCitationStyleChip: "[N] 标签",
  appearanceCitationStylePill: "胶囊形",

  // 安全面板
  securityJwtTitle: "当前 JWT（已解码）",
  securityCopyBtn: "复制",
  securityCopiedBtn: "已复制",
  securityClaimsLoading: "// 会话加载中…",
  securityTokenExpiryLabel: "令牌有效期",
  securityTokenExpiryHint: "到达 exp 时间后需要重新登录",
  securityTokenRemainingFormat: "{lifetime}（剩余 {remaining}）",
  securityTokenExpired: "已过期",
  securityTokenLifetimeHours: "{h} 小时",
  securityRememberTokenLabel: "保存 Refresh Token",
  securityRememberTokenHint:
    "开启：关闭浏览器后保持 30 天登录状态 / 关闭：退出时销毁",
  securityRevokeAllBtn: "在所有设备上退出登录",
  securityRevokingBtn: "退出中…",

  // 账户面板
  accountDisplayNameLabel: "显示名称",
  accountLanguageLabel: "语言",

  // ===== help-modal =====
  helpAriaLabel: "ARag 帮助",
  helpVersion: "v2.4 · 帮助",

  // 标签页
  helpTabOverview: "概述",
  helpTabWorkflow: "基本流程",
  helpTabFeatures: "主要功能",
  helpTabShortcuts: "快捷键",
  helpTabTips: "使用技巧",

  // 底部链接
  helpDocs: "文档",
  helpContactSupport: "联系支持",

  // 概述页
  overviewHeroTag: "AGENTIC RAG",
  overviewHeroTitle: "用智能体的眼光检索企业知识。",
  overviewHeroBody:
    "ARag 跨越会议记录、Wiki、Slack、数据库回答你的问题，是一款<strong>智能体型 RAG 助手</strong>。它不只是简单搜索，而是通过多步骤追踪信息源，并附带引用说明依据。",
  overviewStatDocs: "已索引文档",
  overviewStatSources: "已接入数据源",
  overviewStatSpeed: "平均响应时间",
  overviewCard01Title: "基本流程",
  overviewCard01Desc: "从提问到智能体执行、再到带引用回答的 3 个步骤。",
  overviewCard02Title: "主要功能",
  overviewCard02Desc: "范围筛选、附件、工具可视化、引用面板、共享的使用方法。",
  overviewCard03Title: "快捷键",
  overviewCard03Desc: "⌘N / ⌘K / ⌘B 等，无需停顿即可流畅操作的按键。",
  overviewCard04Title: "使用技巧",
  overviewCard04Desc: "提问技巧、提升精度的小窍门、以及应避免的使用方式。",

  // 基本流程页
  workflowLead: "ARag 分 <strong>3 个阶段</strong>运作。每个阶段全程可视化，随时可介入。",
  workflowStep01Title: "输入问题",
  workflowStep01Body:
    `在屏幕底部的编辑框中用自然语言输入问题。包含"何时""谁""为何"等 5W1H 要素可以提高精度。`,
  workflowStep01Hint:
    "可以用左侧的范围选择器缩小检索范围（全公司、项目、特定团队）。",
  workflowStep02Title: "智能体追踪信息源",
  workflowStep02Body:
    "依次执行：查询分解 → 向量检索 → 获取原始资料 → 去重 → 生成回答，多步骤运作。进度可通过工具执行卡片实时查看。",
  workflowStep02Hint: "如果方向出错，可用 ⌘⌫ 或停止按钮立即取消。",
  workflowStep03Title: "接收带引用的回答",
  workflowStep03Body:
    "回答中的编号 [1] [2] 是指向原始资料的引用。点击后右侧面板会高亮对应段落，便于核实依据。",
  workflowStep03Hint:
    "支持 👍/👎 反馈、复制、重新生成以及 Markdown 导出。",

  // 主要功能页
  featuresLead: "ARag 的各项功能旨在<strong>用最少操作实现深度挖掘</strong>。",
  featScopeTitle: "检索范围筛选",
  featScopeBody:
    `通过编辑框左侧的选择器缩小检索范围，可选"全公司""按项目""指定数据源"等。范围过宽会引入噪音，建议从小范围开始逐步扩大。`,
  featAttachTitle: "文件附件",
  featAttachBody:
    `可以将 PDF、Word、电子表格、图片拖放到问题中作为附件。直接用"总结这份资料"或"提取决定事项"等方式提问即可。`,
  featStepsTitle: "工具执行可视化",
  featStepsBody:
    `每个步骤（查询分解、检索、获取、摘要）以卡片形式展示。可在调整面板中切换"卡片""时间轴""终端风格日志"三种视图。`,
  featCiteTitle: "引用与原始资料面板",
  featCiteBody:
    "点击回答中的 [1] [2] 会打开右侧面板并高亮对应内容。原始资料可直接下载、在新标签页查看或通过共享链接分发。",
  featThreadTitle: "对话管理",
  featThreadBody:
    "历史对话可从侧边栏即时重新打开。支持搜索框过滤、以及收藏、项目、数据源集合整理。",
  featShareTitle: "共享与导出",
  featShareBody:
    "可将整个对话导出为共享链接或 Markdown。原始资料也可单独共享。对内共享会继承查看权限，对外共享会生成脱敏副本。",

  // 快捷键页
  shortcutsLead: "<strong>⌘</strong> 在 macOS 上使用，Windows / Linux 请替换为 <strong>Ctrl</strong>。",
  shortcutsGroupBasic: "基本操作",
  shortcutsNewThread: "新建对话",
  shortcutsOpenSettings: "打开设置",
  shortcutsToggleSidebar: "展开/收起侧边栏",
  shortcutsOpenSidebar: "打开侧边栏",
  shortcutsCloseModal: "关闭弹窗 / 面板",
  shortcutsGroupRunning: "执行中",
  shortcutsStopAgent: "停止智能体执行",
  shortcutsSend: "发送问题",
  shortcutsNewline: "在编辑框中换行",
  shortcutsGroupAnswer: "回答",
  shortcutsCopyAnswer: "复制回答（焦点时）",
  shortcutsRegenerate: "重新生成回答",
  shortcutsJumpCitation: "跳转到引用 [N]",

  // 使用技巧页
  tipsLead: "提问方式的不同，会让智能体的体感速度和精度产生很大变化。",
  tipDo01Title: "包含具体限定条件",
  tipDo01Body:
    `明确标注"2024年Q3""营业团队"等时间、主体、对象，有助于智能体缩小检索范围。`,
  tipDo02Title: "拆分多个问题",
  tipDo02Body:
    `同时问"A 的背景和 B 的未来方针"这类复合问题会降低精度，建议分开对话或按顺序提问。`,
  tipDo03Title: "展开缩写",
  tipDo03Body:
    "公司内部特有的缩写（如：PJK, OKR-Q3）在首次出现时展开，有助于智能体命中正确索引。",
  tipDont01Title: "对外共享机密信息",
  tipDont01Body:
    `共享对话时权限会随之传递，对外共享请选择"脱敏副本"。`,
  tipDont02Title: "检索范围过宽",
  tipDont02Body:
    `总是以"全公司"检索会增加噪音，限定到项目/团队级别可同时提升速度和精度。`,
  tipDont03Title: "轻信回答",
  tipDont03Body:
    "智能体会标注引用来源，但解释仍需通过原始资料核实。👎 反馈将用于改进。",
  tipsTryTitle: "先来试一试",
  tipsTryDesc: "从空对话中的推荐问题开始，体验智能体的运作方式。",
  tipsTryNewThread: "新建对话",

  // ===== share-modal =====
  shareItemTitle: "共享资料",
  shareThreadTitle: "共享对话",
  shareAccessLabel: "访问权限",
  sharePermPrivateLabel: "仅自己",
  sharePermPrivateDesc: "即使知道链接也无法访问",
  sharePermTeamLabel: "团队内（ARag, Inc.）",
  sharePermTeamDesc: "仅限已登录的员工",
  sharePermLinkLabel: "知道链接的人",
  sharePermLinkDesc: "公司外部人员也可查看",
  shareCopyBtn: "复制",
  shareCopiedBtn: "已复制",
  shareCancelBtn: "取消",
  shareCopyAndCloseBtn: "复制链接并关闭",

  // ===== confirm-modal =====
  confirmDefaultLabel: "确定",
  cancelDefaultLabel: "取消",
};
