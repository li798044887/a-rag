# エージェント挙動設定の実装 — 設計

日付: 2026-06-02

## 背景

`設定 → エージェント挙動`（`SettingsModal` の `agent` セクション）の UI は既に
`src/components/modals/settings-modal.tsx`（307–342 行）に存在する。しかし配線が
使い捨ての `useState`（`agentCfg`）であり、

- リロードで値が消える（永続化なし）
- バックエンドのエージェント挙動に一切影響しない（モック）

という状態。本作業ではこの4項目を **永続化し、実際にエージェント挙動へ反映** する。

対象4項目:

| 項目 | キー | 型 | 既定 |
|------|------|----|------|
| 最大ステップ数 | `maxSteps` | number | 12 |
| 並列ツール実行 | `parallelTools` | number | 3 |
| 引用の必須化 | `requireCitations` | boolean | true |
| 未知の場合に "わからない" と返す | `admitUnknown` | boolean | true |

## 決定事項（ブレインストーミングで確定）

- **範囲**: 永続化＋バックエンド反映（UI 完結に留めない）
- **永続化先**: `localStorage`＋chat リクエストへ同梱（`useTweaks` と同型）。DB は使わない
- **並列ツール実行**: 自前ツール内のセマフォで実際に同時実行数を制限する
  （Vercel AI SDK には同時実行ツール数の直接設定が無いため）
- **クランプ**: `maxSteps` 1–20 / `parallelTools` 1–8。`requireCitations`/`admitUnknown` は boolean 補完

## データフロー

```
useAgentCfg (localStorage: "arag:agent-cfg")
   ↓ agentCfg / setAgentCfg
workspace.tsx
   ├─ props ─────────────→ SettingsModal (throwaway useState を撤去)
   └─ agent.run(..., agentCfg)
          ↓
       use-agent.ts run()  → fetch("/api/chat") body に agentCfg 同梱
          ↓
       /api/chat/route.ts  → clampAgentCfg(body.agentCfg)
          ↓
       runAgent(RunInput { agentCfg })
          ├─ maxSteps                       → stopWhen: stepCountIs(maxSteps)
          ├─ requireCitations / admitUnknown → buildSystemPrompt(cfg)
          └─ parallelTools                   → buildTools({ concurrency }) → Semaphore
```

## モジュール変更

### 新規

**`src/lib/agent/config.ts`**（クライアント/サーバー共用・純モジュール、client 専用依存なし）
- `AGENT_CFG_DEFAULTS: AgentCfg`（上表の既定値）
- 境界定数: `MAX_STEPS_MIN=1, MAX_STEPS_MAX=20, PARALLEL_MIN=1, PARALLEL_MAX=8`
- `clampAgentCfg(raw: unknown): AgentCfg`
  - 数値は `Number()`→`Math.round`→範囲クランプ。`NaN`/欠損は既定へ
  - boolean は欠損時に既定へ補完
  - `null`/非オブジェクト入力でも既定の完全な `AgentCfg` を返す
- `buildSystemPrompt(cfg: AgentCfg): string`
  - 基本文（社内ナレッジ検索アシスタント、retrieve/fetch_document、Markdown 構造化）
  - `requireCitations` ON: 「重要な事実には必ず [1][2] の出典番号を付ける」節を含む。OFF: 緩和
  - `admitUnknown` ON: 「資料に無いことは推測せず、わからない場合は『わからない』と答える」節を含む。OFF: 当該節を外す

**`src/lib/agent/semaphore.ts`**
- `class Semaphore { constructor(max: number); run<T>(fn: () => Promise<T>): Promise<T> }`
- 同時に走る `fn` を `max` 件までに制限。`max < 1` は 1 に丸める

**`src/hooks/use-agent-cfg.ts`**
- `useTweaks` と同じ `useSyncExternalStore`＋localStorage パターン
- ストレージキー `arag:agent-cfg`（`THEME_STORAGE_KEY` とは別）
- `clampAgentCfg` を介して読み出し、`{ agentCfg, setAgentCfg }` を返す
- `setAgentCfg<K extends keyof AgentCfg>(key, value)` の単項更新（`setTweak` と同型）

### 変更

**`src/lib/types.ts`** — `AgentCfg` インターフェース追加

**`src/lib/agent/tools.ts`** — `BuildToolsInput` に `concurrency: number` 追加。
`buildTools` 冒頭で `new Semaphore(concurrency)` を生成し、`retrieve` と `fetch_document`
両方の `execute` 本体を `sema.run(() => ...)` でラップ（戻り値・例外は透過）。

**`src/lib/agent/run.ts`**
- `RunInput` に `agentCfg?: AgentCfg`
- `pump` 内で `const cfg = input.agentCfg ?? AGENT_CFG_DEFAULTS`
- `MAX_STEPS=6` ハードコードを撤去 → `stopWhen: stepCountIs(cfg.maxSteps)`
- `system: SYSTEM` → `system: buildSystemPrompt(cfg)`
- `buildTools({ ..., concurrency: cfg.parallelTools })`

**`src/app/api/chat/route.ts`**
- body 型に `agentCfg?: unknown` 追加
- `const agentCfg = clampAgentCfg(body.agentCfg)` を `runAgent` に渡す
  （未指定/不正でも `clampAgentCfg` が既定を返すので常に有効値）

**`src/hooks/use-agent.ts`**
- `run()` の引数に `agentCfg: AgentCfg` を追加（`modelId` の後）
- fetch body に `agentCfg` を同梱

**`src/components/workspace/workspace.tsx`**
- `const { agentCfg, setAgentCfg } = useAgentCfg()`
- `agent.run(...)` 呼び出しに `agentCfg` を渡す（209 行付近）
- `<SettingsModal>` に `agentCfg`/`setAgentCfg` を渡す

**`src/components/modals/settings-modal.tsx`**
- `Props` に `agentCfg: AgentCfg`・`setAgentCfg` を追加
- throwaway `const [agentCfg, setAgentCfg] = useState(...)` を撤去
- `agent` セクションの onChange/onToggle を `setAgentCfg(key, value)` へ置換
- 数値入力は `setAgentCfg("maxSteps", Number(e.target.value))` のまま（最終クランプはサーバー）
- 見た目（レイアウト・クラス）は現状維持

**`src/components/modals/settings-modal.stories.tsx`** — 追加 props のモックを供給

## 既定値の統一

現状は UI=12 / バックエンド `MAX_STEPS=6` で不一致。`AGENT_CFG_DEFAULTS.maxSteps = 12`
に統一し、バックエンド既定も同値（`agentCfg` 未指定時のフォールバック）にする。

## エラー処理

- localStorage 由来の不正 JSON・型崩れ・範囲外値はすべて `clampAgentCfg` で吸収
  （クライアント読み出し時とサーバー受信時の二重防御）
- localStorage 書き込み失敗（容量・プライベートモード）は `useTweaks` 同様 try/catch で握り潰す
- `agentCfg` 未送信の古いクライアントでも、サーバーは既定値で動作（後方互換）

## テスト（TDD）

純関数・小ユニット中心に単体テストを置く（既存の vitest 構成に合わせコロケーション）:

- `config.test.ts`
  - `clampAgentCfg`: 範囲外（0, 100, -1）→クランプ、文字列数値→整数化、`NaN`→既定、
    欠損キー→既定、`null`/配列入力→完全な既定、boolean 欠損→既定
  - `buildSystemPrompt`: 4トグルの組合せで該当節の有無を検証（引用強制節・「わからない」節）
- `semaphore.test.ts`
  - 同時実行カウントのピークが `max` を超えない
  - 全タスクの解決と FIFO 的な進行、`max<1` の丸め

UI/フック/ルートは既存テストの慣習に従い、必要に応じて軽い結線テストを追加。

## スコープ外（YAGNI）

- DB 永続化・複数端末同期
- `parallelTools` をモデルの並列呼び出し意思決定そのものへ反映すること
  （あくまで自前ツールの実行同時数の上限制御に留める）
- 設定のインポート/エクスポート・プリセット
