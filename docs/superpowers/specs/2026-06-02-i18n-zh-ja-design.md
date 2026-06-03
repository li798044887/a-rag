# 中日双语支持（i18n）设计书

- 日期：2026-06-02
- 分支：dev-i18n
- 状态：已确认，待编写实现计划

## 1. 背景与目标

当前应用界面文案与 RAG 系统提示词均为**日语硬编码**，分散在 `src/` 下约 60+ 个源文件中（其中相当一部分是日语注释，真正的用户可见文案集中在各 `components/` 与部分 `api` 路由）。项目尚无任何 i18n 基础设施。

本需求引入**中文 / 日语**双语支持：

- **中文为默认语言**，首次访问时界面与 prompt 均为中文。
- 提供手动语言切换入口（低频功能），切换需明确提示并二次确认。
- 语言偏好持久化，**优先 Cookie 存储**（清除后允许丢失，后续可扩展账户持久化）。
- 界面文案**全量翻译**；所有功能性 prompt（含 RAG 检索相关系统提示词）按当前语言**动态切换**。
- 中文 prompt **不机翻**，以 RAG 专家视角专门优化，保证中文文档/中文提示词环境下的检索可靠性与回答一致性。

## 2. 已确认的关键决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| 路由策略 | **纯 Cookie，URL 不变** | 契合「优先 Cookie」「低频切换」，改动最小，不与改版 Next.js 16 路由冲突 |
| i18n 机制 | **轻量级自建词典 + React Context** | 仅两种语言、纯 Cookie 场景；零新依赖、类型安全、易测试，不与改版 Next.js 16 冲突 |
| 切换行为 | **写 Cookie + 刷新页面（`location.reload()`）** | 保证 SSR 文案与后续 prompt 完全一致，无 hydration 不一致；确认弹窗用于提示「页面将刷新」 |
| 切换入口 | **设置弹窗「外观」标签页** | 符合低频定位，复用现成 `Select`/`Field` 组件 |
| 词典粒度 | **B：按功能命名空间拆分多文件** | 便于分批翻译与并行执行，每个命名空间独立可验证 |
| E2E 对 RAG 的断言 | **mock 后端，断言 prompt 语言 + 界面语言正确** | E2E 稳定、快、不消耗 API；RAG 回答质量由中文 prompt 的单元测试保障 |

## 3. 现状勘察结论

- **无现成 i18n**：无 i18n/locale/intl 相关基础设施。
- **RAG prompt 在 TS 层**，集中在：
  - `src/lib/agent/run.ts`：`SYSTEM` 系统提示词、`buildUserContent()` 附件提示模板、兜底文案（生成失败 / 无资料）、`toolLabel()` / `runningSummary()` 工具标签与状态文案、「回答生成」步骤标签与 summary、`rewrite_query` 的「クエリ正規化」标签。
  - `src/lib/agent/tools.ts`：工具 `description`、zod 参数 `.describe()`、工具结果兜底文案（如「文書の本文が取得できませんでした」）、`vector_search`/`bm25_search` 等子步骤标签与状态文案。
- **Python `rag` 后端不含生成 prompt**：仅做检索 / 嵌入（BGE-M3 多语言）/ 重排，语言无关，**本期不改动**。
- **注入点**：`src/app/layout.tsx` 为 `<html lang="ja">` + theme 引导脚本；`src/app/api/chat/route.ts` 调 `runAgent()`。
- **现成可复用 UI**：`settings-modal.tsx` 已有「外観（appearance）」标签页及 `Select`/`Field` 组件；`use-confirm.tsx` + `confirm-modal.tsx` 提供确认弹窗。
- **Next.js 16 改版**：`cookies()` 为 **async**（`await cookies()`），`src/lib/auth.ts` 已如此使用。

## 4. 架构设计

### 4.1 语言模型

- `Locale = "zh" | "ja"`，`DEFAULT_LOCALE = "zh"`。
- Cookie：名 `arag_locale`，`Max-Age` 1 年，`path=/`，`SameSite=Lax`，**非 httpOnly**（客户端写入、服务端读取）。

### 4.2 新增 i18n 模块 `src/i18n/`

```
src/i18n/
  config.ts            # Locale 类型、DEFAULT_LOCALE、LOCALE_COOKIE、语言清单与显示名、isLocale() 校验
  dictionary.ts        # getDictionary(locale)、t(dict, key, vars?) 插值助手
  server.ts            # getLocale()：服务端 await cookies() 读取 + 校验 + 回退（server-only）
  context.tsx          # LocaleProvider（client）+ useT() hook
  locales/
    zh/
      index.ts         # 聚合各命名空间，导出 zh 词典（唯一事实来源）
      common.ts        # 通用：确认/取消/关闭/加载中/重试 等
      sidebar.ts
      chat.ts          # composer / messages / empty-state / scope-picker / tool-steps / agent-activity / answer-footer / cited-text
      auth.ts          # login
      uploads.ts
      documents.ts
      modals.ts        # settings / help / share / confirm 中的文案
      sources.ts       # right-panel / table-sheet 等
      workspace.ts
      api.ts           # API 路由面向用户的错误 / 提示文案
    ja/
      index.ts
      common.ts        # ...（结构与 zh 镜像；内容=现有日语原文迁入）
      ...（同名命名空间）
```

- **键对等保障**：`zh` 为唯一事实来源。每个 `ja/<ns>.ts` 用 `satisfies typeof import("../zh/<ns>")`（或等价类型）在**编译期**强制与同名 zh 命名空间键完全对等；另在单元测试中增加运行时遍历断言作为双保险。
- `getDictionary(locale)` 返回该 locale 的聚合词典对象；`t()` 提供 `{var}` 插值。组件主要通过 `useT()` 取已解析好的词典对象按命名空间访问（如 `t.chat.sendButton`）。

### 4.3 注入路径

- `src/app/layout.tsx`（server 组件）：
  - `const locale = await getLocale()`。
  - `<html lang={locale === "zh" ? "zh-CN" : "ja"}>`。
  - 用 `<LocaleProvider locale={locale} dict={getDictionary(locale)}>` 包裹 `children`。
- 客户端组件经 `useT()` 取文案；个别 server 组件可直接 `getDictionary(getLocale())`。

### 4.4 RAG prompt 动态切换（服务端）

- 新模块 `src/lib/agent/prompts.ts`：
  - `getAgentPrompts(locale): AgentPrompts`，返回 `{ system, userContentTemplate, fallback: { genFailed, noSources, genUnavailable, fetchEmpty }, toolDescriptions, toolDescribe, toolLabels, runningSummaries, answerStep }`，内含 zh / ja 两套。
  - **中文 system prompt 以 RAG 专家视角重写（非机翻）**，要点：
    - 角色：企业内部知识检索助手。
    - 必要时调用 `retrieve` / `fetch_document`，结合对话上下文构造**自包含的中文检索 query**。
    - 回答**仅依据**检索到的一次资料，用**中文**简洁作答。
    - 关键事实必须附带工具结果中的 `[1] [2]` 出典号。
    - 用 Markdown 结构化（`**加粗**` 标题、`-` 列表）。
    - 资料中没有的内容不臆测。
  - 日语 system prompt = 现有 `run.ts` 中 `SYSTEM` 原文迁入。
- `src/lib/agent/run.ts`：
  - `RunInput` 增 `locale: Locale` 字段。
  - 移除模块级 `SYSTEM` 常量，改为 `const prompts = getAgentPrompts(locale)`。
  - `buildUserContent()` 增 `locale`（或接收模板），使用本地化附件提示模板。
  - `system: prompts.system`；兜底文案、`toolLabel()`、`runningSummary()`、`emitAnswerStep` 的 `label`/`summary`、`rewrite_query` 标签均改为按 locale 取值。
- `src/lib/agent/tools.ts`：`buildTools` 入参增 locale（或 prompts），工具 `description`、zod `.describe()`、工具结果兜底文案、子步骤标签/状态文案本地化。
- `src/app/api/chat/route.ts`：`const locale = await getLocale()`，传入 `runAgent({ ..., locale })`。

### 4.5 语言切换 UI

- 在 `settings-modal.tsx` 的「外観 / 外观」标签页新增「语言 / 言語」`Select`（选项 zh / ja，显示名来自 `config.ts`）。
- onChange（选中值 ≠ 当前 locale 时）→ 调 `useConfirm()` 弹确认框：
  - 文案（取自词典）：标题「切换语言」/ 正文「切换语言会刷新页面，确定继续吗？」/ 确认「继续」/ 取消「取消」。
  - 确认 → 写 cookie（`document.cookie = "arag_locale=<v>; path=/; max-age=31536000; samesite=lax"`）→ `location.reload()`。
  - 取消 → Select 还原为当前 locale。
- 切换逻辑抽成纯函数（如 `applyLocaleChange(next)` 中的 cookie 串构造 `buildLocaleCookie(locale)`）以便单测。

## 5. 翻译范围

**纳入（用户可见文案，全量翻译）**：
- 组件：`sidebar`、`chat`（composer / messages / empty-state / scope-picker / tool-steps / agent-activity / answer-footer / cited-text）、`auth/login`、`uploads`、`documents`、`modals`（settings / help / share / confirm）、`feedback/toasts`、`sources`（right-panel / table-sheet 等）、`workspace`。
- API 路由面向用户的消息（错误 / 提示）：`auth/*`、`upload`、`uploads/stream`、`threads`、`chat` 等，经 `getLocale()` 本地化。
- `layout.tsx` 的 `metadata`（title / description）。
- `<html lang>`、`toLocaleString` 的 locale 参数（如 `empty-state.tsx` 的 `"ja-JP"`）按当前 locale 切换。

**不纳入**：
- 日语**代码注释**（非用户可见，翻译只会徒增 diff，不在需求内）。
- Python `rag` 后端（语言无关）。

**默认语言文案来源**：zh 文案为**新写中文**；ja 文案=现有日语原文迁入词典。

## 6. 测试策略

### 6.1 单元测试（vitest）
- `config`/`dictionary`：
  - **键对等 parity**：遍历每个命名空间，断言 `ja` 与 `zh` 键集合完全一致（编译期 `satisfies` 之外的运行时双保险）。
  - `t()` 插值：`{var}` 替换正确，缺失变量行为明确。
  - `isLocale()` 校验、`DEFAULT_LOCALE` 回退。
- `server.getLocale()`：cookie 命中各 locale；缺失 / 非法值回退默认（mock `next/headers cookies()`）。
- `prompts.getAgentPrompts()`：
  - 各 locale 返回对应 `system`/工具文案。
  - 断言**中文 prompt 关键特征**存在（如「仅依据」「出典」「中文」等约定特征串）以防被机翻或回退覆盖。
  - `buildUserContent()` 按 locale 输出正确模板。
- 切换逻辑：`buildLocaleCookie(locale)` 生成正确 cookie 串。

### 6.2 构建门槛
- **`pnpm build` 必须通过**（E2E 前置）。

### 6.3 E2E（playwright，mock 后端）
- 默认（无 cookie）首次访问：界面为中文（断言关键中文文案、`<html lang="zh-CN">`）。
- 打开设置 → 外观 → 选「日语」→ 出现确认弹窗 → 确认 → 页面 reload → 界面变日语（断言关键日语文案、`<html lang="ja">`、cookie 已写入）。
- 取消路径：弹确认 → 取消 → 语言不变、无 reload。
- prompt 语言验证：mock / 拦截 chat 后端，断言切换语言后发往模型的 system prompt 为**目标语言**（中文 / 日语特征），且界面同步为目标语言。

## 7. 风险与注意事项

- **改版 Next.js 16**：写码前查 `node_modules/next/dist/docs` 关于 `cookies()`/`headers()` 用法；已确认 `cookies()` 为 async。
- **文案量大**：实现计划须**按功能命名空间分批**，每批（一个 namespace + 对应组件改造）独立可验证，降低单次改动风险。
- **SSR 与 client 一致性**：切换即 reload，从根上规避 hydration mismatch。
- **遗漏硬编码文案**：分批迁移过程中以「该命名空间相关组件内不再出现日语字面量（注释除外）」为完成判据，必要时辅以 lint/grep 检查。
- **后续可扩展**：Cookie 之上预留账户级持久化（本期不做）。

## 8. 非目标（YAGNI）

- URL 路径前缀路由 / 语言专属可分享链接。
- 第三种语言或运行时动态加载语言包。
- 翻译日语代码注释。
- Python 后端国际化。
- 账户级语言偏好持久化（仅预留扩展位）。
