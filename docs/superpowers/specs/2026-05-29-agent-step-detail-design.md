# 検索サブステップの詳細展開（候補・リランク内訳の表示）

## 背景と目的

先行実装（`docs/superpowers/specs/2026-05-29-fine-grained-agent-steps-design.md`）で、retrieve の内部段階（embed / vector_search / bm25_search / rerank / expand）を `retrieve` の子サブステップとしてライブ表示できるようになった。ただし子サブステップは**コンパクトな非展開行**（status / name / summary / ms のみ）で、各段階の中身は見えない。

本設計の目的は、検索過程を**できるだけ詳細に**見せること。具体的には:
- `vector_search` / `bm25_search` が返した**候補（最大 candidate_k=40 件）の一覧**（スコア・文書名・見出し）
- `rerank` が選んだ**上位 top_k=6 件**（正規化スコア・文書名）
- `embed`（モデル名・次元数）、`expand`（拡張件数）の基本情報

これらを 3 つの外観バリアント（**card / timeline / log**）すべてで一貫して表示する。

## 決定事項（ブレインストーミングでの合意）

1. **候補の詳細度**: `vector_search`/`bm25_search` の候補は「**スコア + 文書名 + 見出し**」で一覧表示（本文抜粋は出さない）。
2. **rerank**: 上位 top_k を「**正規化スコア（0〜1）+ 文書名**」のスコアバーで表示。reranker は `compute_score(normalize=True)` 済みなので 0〜1。
3. **3 バリアント全対応**: card / timeline は**展開可能サブステップ**（共有コンポーネント）で `入力`/`出力` を表示。log（ターミナル風）は各サブステップの `done` 行の後に**詳細行を字下げ追記**（長い一覧は上位 N 件 + 「… 他X件」で打ち切り）。
4. **再利用優先**: rerank のスコアバー描画は既存の `ToolOutputBlock`（`output.selected: RerankHit[]`）をそのまま流用。候補一覧は新レンダラを追加。

## アーキテクチャ / データフロー

### バックエンド（`rag/`）

#### モデル名の公開（`app/embedding/base.py`, `app/reranker/base.py` + 実装）
段階イベントにモデル名を載せるため、Protocol と実装に `name: str` を追加する。
- `Embedder` Protocol に `name: str`。`BGEM3Embedder.name = "BAAI/bge-m3"`、`StubEmbedder.name = "stub"`。
- `Reranker` Protocol に `name: str`。`BGEReranker.name = "BAAI/bge-reranker-v2-m3"`、`StubReranker.name = "stub"`。

#### `app/retrieval/service.py` `retrieve_stream`
`done` イベントに詳細フィールドを追加する。`title_cache` を関数先頭で 1 つ作り、候補タイトル解決・rerank・expand で共有する（重複文書は 1 回だけ `session.get(Document)`）。

ヘルパ追加:
```python
def _hit_rows(session, hits, title_cache):
    # hits: dense/sparse_search が返す payload dict のリスト
    rows = []
    for h in hits:
        doc_id = h["document_id"]
        if doc_id not in title_cache:
            doc = session.get(Document, doc_id)
            title_cache[doc_id] = doc.filename if doc else doc_id
        rows.append({"title": title_cache[doc_id],
                     "heading": h.get("heading_path", ""),
                     "score": float(h.get("score", 0.0))})
    return rows
```

各 `done` イベント:
- `embed`: `{ "stage":"embed","status":"done","ms":..., "model": embedder.name, "dims": len(qv.dense) }`
- `vector_search`: `{ ..., "ms":..., "count": len(dense_hits), "hits": _hit_rows(session, dense_hits, title_cache) }`
- `bm25_search`: `{ ..., "ms":..., "count": len(sparse_hits), "hits": _hit_rows(session, sparse_hits, title_cache) }`
- `rerank`: `{ ..., "ms":..., "count": len(ranked), "model": reranker.name, "top_n": top_k, "selected": [ {"id": h["chunk_id"], "score": float(s), "title": title_cache.get(h["document_id"], h["document_id"]) } for h, s in ranked ] }`（ranked の文書は候補に含まれるため title_cache に解決済み）
- `expand`: `{ ..., "ms":..., "count": len(out) }`

> 並行検索ブロック内の `done` yield は、各 future の `.result()` 取得後にメインスレッドで `_hit_rows`（= `session` アクセス）を行う。検索自体はスレッド実行だが DB アクセスはメインスレッドのみなのでセッションのスレッド安全性は保たれる。

empty-results 短絡パスでも `hits: []` / `selected: []` を載せて形を揃える。

### NDJSON / TS クライアント（`src/lib/agent/retrieve-client.ts`）
`RetrieveStageEvent` に任意フィールドを追加（pass-through のみ、ロジック変更なし）:
```typescript
export interface RetrieveStageEvent {
  stage: string;
  status: "start" | "done" | "error";
  ms?: number;
  count?: number;
  message?: string;
  model?: string;
  dims?: number;
  top_n?: number;
  hits?: { title: string; heading: string; score: number }[];
  selected?: { id: string; score: number; title: string }[];
}
```

### `src/lib/agent/tools.ts` `stageToEvent`
段階ごとに `input` / `output` を構築（query は execute から渡す。`stageToEvent(ev, parentId, query)` にする）:
- `embed`: input `{ model: ev.model }`、output `{ dims: ev.dims }`
- `vector_search`: input `{ mode: "dense", query }`、output `{ count: ev.count, hits: ev.hits }`
- `bm25_search`: input `{ mode: "sparse", query }`、output `{ count: ev.count, hits: ev.hits }`
- `rerank`: input `{ model: ev.model, top_n: ev.top_n }`、output `{ count, selected: ev.selected }`
- `expand`: output `{ count }`
- `start` イベントは従来どおり running（input/output は空/null）。

`RerankHit` 型（`src/lib/types.ts`）は既存の `{ id; score; title }` を流用（rerank output.selected がこの形）。

### UI（`src/components/chat/tool-steps.tsx`）

3 バリアントで一貫対応する。

**共通: 展開可能サブステップコンポーネント**
- 現行 `SubStepRow`（非展開）を、詳細がある場合に**展開可能**な行へ置き換える。`isExpandable(step)`（既存: `hasInputData(input) || output != null`）で判定。
- collapsed: 現行のコンパクト行 + 詳細があればシェブロン。
- expanded: 既存 `ToolInputBlock` / `ToolOutputBlock` を表示。
- card / timeline 双方がこの同一コンポーネントを使う（インデントの装飾だけ各バリアントで付与）。展開状態は既存の `expandedMap` / `onToggleStep`（id キー）で管理。子 id は `${parentId}:${stage}` で一意。

**`ToolOutputBlock` 拡張（候補一覧レンダラ追加）**
- `vector_search` / `bm25_search` かつ `Array.isArray(output.hits)`: 各候補を「スコアバー + `文書名 — 見出し`」の行で一覧表示（既存の rerank スコアバー描画に近い構造の新規ブロック）。スコアは検索スコアの相対表示（リスト内最大値で正規化してバー幅 = score/max）。
- `rerank` の `output.selected`（`RerankHit[]`）: **既存の描画をそのまま流用**（変更不要）。
- `expand` / `embed` 等で output が件数・dims のみ: 既存の `KeyValueGrid` か JSON フォールバックで表示。

**`ToolInputBlock` 拡張**
- `vector_search` / `bm25_search`: `mode` / `query` を KeyValueGrid + query ブロックで表示。
- `rerank`: `model` / `top_n` を KeyValueGrid。
- `embed`: `model` を KeyValueGrid。

**log バリアント（`ToolStepLog`）拡張**
- 各サブステップの `done` 行の直後に、詳細行を字下げ（`name` 列空 or インデント）で追記:
  - `vector_search`/`bm25_search`: `hits` を上位 `LOG_DETAIL_MAX`（=8）件まで「`score  title — heading`」で出し、超過分は「… 他 N 件」。
  - `rerank`: `selected` を上位 `LOG_DETAIL_MAX` 件まで「`score  title`」で出す。
  - `embed`: 「`model=… dims=…`」。
  - `expand`: 「`expanded N`」。
- 詳細行は `kind: "detail"` として薄色で表示。

## 永続化・性能

- **永続化**: チャットルートが収集する `steps` の各サブステップ output に `hits`/`selected` 配列が乗るため保存サイズが増える（1 質問あたり概ね数 KB）。リロード時も `groupSteps` 経由で同様に再描画される。
- **性能**: 候補タイトル解決は共有 `title_cache` でユニーク文書のみ参照（数回）。NDJSON は 1 質問あたり +数 KB 程度。検索の並行実行・candidate_k 据え置きは不変。リランク・検索のレイテンシに影響なし。

## エラー処理

- `start` 後に段階が失敗した場合の挙動は先行実装どおり（stream 中断 → 親 retrieve が error）。詳細フィールドは `done` のみに載るため、失敗時は単に詳細なしで終わる。

## テスト

### バックエンド
- `retrieve_stream` の `vector_search`/`bm25_search` の `done` に `hits`（title/heading/score を持つ）が載り、`rerank` の `done` に `selected`（id/score/title）と `model`/`top_n` が載ること。
- `embed` done に `model`/`dims`、`expand` done に `count` が載ること。
- `title_cache` 共有で候補タイトルが解決されること（StubEmbedder/StubReranker + 実 Document で検証）。

### TS
- `retrieveChunksStream` が新フィールド（hits/selected/model/dims）を `onStage` にそのまま渡すこと（NDJSON モック）。
- `stageToEvent` が各段階の input/output を期待どおり構築すること（vector_search→hits、rerank→selected 等）。

### UI
- `ToolOutputBlock` が `vector_search` の `output.hits` を候補一覧として描画すること、`rerank` の `selected` を既存スコアバーで描画すること。
- 詳細を持つサブステップが展開可能（`isExpandable`）になり、持たないもの（start のみ/空）は非展開のままであること。
- `ToolStepLog` が各サブステップの詳細行を出し、長い一覧を `LOG_DETAIL_MAX` で打ち切ること。
- card / timeline / log の 3 バリアントすべてでクラッシュせず描画されること（既存 reducer テストは不変）。

## スコープ外

- `vector_search`/`bm25_search` 候補の**本文抜粋**表示（タイトル+見出しのみ）。
- 候補の無限スクロール/ページング（card/timeline は全件、log は打ち切り）。
- embed の埋め込みベクトルそのものの表示。
