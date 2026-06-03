# 回答品質・可制御性の向上（CRAG 風 grade→再検索 + 根拠検証）設計

- 日付: 2026-06-03
- 対象: エージェント統括（`src/lib/agent/`）と chat フロー
- 状態: 設計確定（実装計画へ）

## 背景と目的

LangGraph 導入の動機は「回答品質の向上」と「可制御性の向上」。調査の結果、品質向上の寄与はフレームワークではなく**追加するノード（処理段階）**にあり、可制御性は器の問題と切り分けられた。

そこで第1弾は**フレームワークを導入せず**、既存の TS / AI SDK（Vercel）統括ループを温存したまま、品質に最も効く2ノードを最小リスクで追加する（C先行方針）。永続化チェックポイントや human-in-the-loop が明確な要件になった段階で LangGraph.js（TS）へ移行する余地は、グラフ構造を先に固めることで確保する。

### 現状フローの確認（実装事実）

```
chat route → runAgent → streamText(AI SDK) + tools{retrieve, fetch_document}, stopWhen: stepCountIs(maxSteps)
   retrieve → Python rag /retrieve/stream（embed→vector_search→bm25→rerank→expand）
   引用は CitationRegistry、UI へは StepBus → AgentEvent → SSE
```

統括は TS、Python rag は検索専任（生成しない）。この所有境界は維持する。

### 解決する不足点（今回の対象）

1. 取得チャンクの関連度を判定して不足時に再検索する仕組みがない（grade→再検索ループ不在）。
2. 生成回答が出典で裏付くかの検証がない。引用は本文の `[n]` を正規表現で拾うだけで、`requireCitations` はプロンプト指示のみで実効力がない。

### 今回の対象外（YAGNI・後続弾）

- ルーティング（雑談 vs 要検索）
- 明示的なクエリ分解（HyDE/多クエリ/サブ質問）※ 再検索ノード内の rewrite として最小限のみ着手
- 適応パラメータ（難易度に応じた top_k/candidate_k 可変化）
- LangGraph(.js) フレームワーク本体の導入

## 設計方針

既存の `streamText` tool ループは壊さず、2か所だけ拡張する。

- **変更点①（生成「前」）**: `retrieve` ツールを CRAG 化する。retrieve → grade → 弱ければ rewrite + 再検索（有限回）→ 最良コンテキストを返す。生成前に効くためストリーミング UX と競合しない。
- **変更点②（生成「後」）**: 生成をバッファ化し、`verify`（根拠検証）→ 必要なら `revise`（訂正再生成・上限1回）→ 確定版を answer-delta でストリーム。本文を確定版に揃えてから流すため正確性を最大化する（バッファ生成→検証→確定方式）。

```
runAgent(pump)
 ├ retrieve ツール = CRAG 化
 │    retrieve → grade → 弱ければ rewrite+再検索（cfg.maxRetrieveRetries, 既定1）→ 最良コンテキスト返却
 │    既存の段階サブステップ機構(StepBus)に grade / rewrite を追加で乗せる。rewritten 引数を実接続
 │
 ├ 生成フェーズ = バッファ化
 │    fullStream を消費し answer を蓄積（この間 answer-delta は出さず "生成中" step を表示）
 │
 ├ verify：draft を registry の出典群と突合 → 未裏付け主張を抽出 → "検証" step
 ├ revise（未裏付けあり かつ cfg.maxRevisions>0）：指摘を与え「出典のみを根拠に」書き直し → "修正" step
 └ 確定ストリーム：最終 answer を answer-delta で流す＋[n]/引用パネルを裏付くものへ補正 → done
```

## コンポーネント

### 新規

| ファイル | 責務 | 入力 | 出力 | 依存 |
|---|---|---|---|---|
| `src/lib/agent/grade.ts` | 取得チャンクの関連度判定（ハイブリッド） | query, chunks（score 付き） | `{ ok: boolean; weak: chunkId[]; needRetry: boolean }` | resolveModels, prompts |
| `src/lib/agent/verify.ts` | groundedness 検証と未裏付け抽出、revise 実行 | draft 回答, registry の出典 snippet | `{ unsupported: 主張[]; revised?: string }` | resolveModels, prompts, CitationRegistry |

#### grade（ハイブリッド方式）

1. まず rerank スコアの閾値（`cfg.gradeThreshold`）で安価にゲートする。十分なら LLM を呼ばずに通過。
2. 閾値近傍（曖昧帯）のチャンクのみ LLM で関連/非関連を判定する。
3. 関連チャンクが不足（件数または最大スコアが基準未満）かつ再検索回数が上限未満なら `needRetry=true`。

これにより通常クエリは追加 LLM コストゼロで通過し、曖昧なときだけ精度を補う。

#### verify（根拠検証）

1. draft 回答を主張単位（文/箇条）に分け、各主張を registry 登録済み snippet と突合する LLM 判定を行う。
2. 未裏付けの主張集合を返す。
3. 未裏付けがあり `cfg.maxRevisions>0` の場合、「未裏付け箇所＋利用可能な出典のみ」を与えて1回だけ書き直す（削除でなく訂正再生成で品質維持）。
4. 確定版本文をストリームし、本文に実際に出現する `[n]` を裏付くものへ補正する（既存の `[n]` 抽出ロジックを確定版に対して適用）。

### 変更

| ファイル | 変更内容 |
|---|---|
| `src/lib/agent/tools.ts` | `retrieve` に grade→再検索ループを内包。`rewritten` を実利用。grade / rewrite サブステップを bus に流す |
| `src/lib/agent/run.ts` | 生成をバッファ化（蓄積中は "生成中" step、answer-delta は出さない）。fullStream 完了後に verify→revise→確定ストリーム。フォールバック維持 |
| `src/lib/agent/prompts.ts` | rewrite / grade / verify / revise のプロンプト断片を zh（出所）+ ja で追加。zh は RAG 専門家視点で最適化、ja は型注釈 + parity テストでキー対等を強制 |
| `src/lib/agent/config.ts` | `AGENT_CFG_DEFAULTS` に新キーを追加し、`clampAgentCfg` で正規化（範囲外を既定へ丸める） |
| `src/lib/types.ts` | `ToolName` に `grade` / `verify` / `revise` を追加（`rewrite_query` は既存）。`AgentCfg` に新フィールドを追加 |
| i18n（`locales/{zh,ja}/*`）/ UI | 新 step 名のラベル。検索→生成中→検証中の**現在ステージ表示**（skeleton やデモ placeholder は出さない＝既存方針に従う） |

### 設定（AgentCfg 追加）

| キー | 既定 | 範囲 | 意味 |
|---|---|---|---|
| `maxRetrieveRetries` | 1 | 0–2 | grade 不足時の再検索の上限回数 |
| `gradeThreshold` | （rerank スコア基準値） | 0–1 | grade の安価ゲート閾値 |
| `maxRevisions` | 1 | 0–1 | verify 失敗時の訂正再生成の上限回数 |
| `verify` | true | bool | 根拠検証フェーズの有効/無効 |

`gradeThreshold` の具体値は rerank スコア分布を見て実装時に決める（暫定値を置き、テストで調整）。

## データフロー・状態

- 検索コンテキストと引用は既存 `CitationRegistry` をそのまま使用。verify は registry に登録済みの snippet を根拠に突合し、追加の永続状態は持たない。
- grade / verify / revise の LLM 呼び出しは既存 `resolveModels` を流用する。将来安価モデルへ差し替えられるよう、モデル選択を引数で受ける配線にする。
- 永続化（`saveCompletedMessage`）は確定版本文・補正後の引用で行う（既存経路のまま、入力が確定版に変わるだけ）。

## エラー処理・フォールバック

- grade / verify / revise が LLM エラー等で失敗 → そのフェーズを**スキップして従来挙動にフォールバック**し、回答は必ず返す。
- 再検索・revise はいずれも cfg 上限で有限回。ループ暴走なし。
- 既存のフォールバック文言（modelUnavailable / noSources / genFailed / genUnavailable）は維持。
- バッファ生成中に fullStream が throw した場合も、蓄積済み draft があればそれを確定扱いにして verify をスキップしストリームする（現行 catch の方針を踏襲）。

## UX 上のトレードオフと緩和

- バッファ化により**初回トークンが遅延**する。緩和策として「検索 → 生成中 → 根拠検証中」の現在ステージを StepBus で逐次表示し、体感の停滞を防ぐ。
- 既存の段階表示（embed/vector_search/…）に grade / verify / revise が自然に並ぶようラベルと順序を設計する。

## テスト

- `grade.test.ts`（新）: 閾値ゲート通過、曖昧帯のみ LLM 呼び出し、再検索フラグの判定。
- `verify.test.ts`（新）: 未裏付け抽出、revise 1回上限、verify=false で素通し、LLM 失敗時フォールバック。
- `run.test.ts`（更新）: バッファ→検証→確定の順序、生成中は answer-delta を出さないこと、revise 分岐、フォールバック経路。
- `tools.test.ts`（更新）: retrieve の grade→再検索ループ、rewritten 接続、サブステップ発火。
- `prompts.test.ts` / i18n parity（更新）: zh/ja の新キー対等。
- `config.test.ts`（更新）: 新 cfg キーの clamp。
- ビルド/型: `pnpm build`・`pnpm exec tsc --noEmit`・`pnpm lint`。

## 段階導入（実装順の指針）

1. 型・設定（types/config）＋プロンプト断片（zh/ja）＋ i18n ラベル。
2. `grade.ts` と retrieve への CRAG 組み込み（生成前ノード）。
3. `verify.ts` と run.ts のバッファ化・verify/revise・確定ストリーム（生成後ノード）。
4. UI の現在ステージ表示調整。
5. テスト整備と閾値調整。

各段階は独立にテスト可能で、1→2→3 の順に価値を出せる。
