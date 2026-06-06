# Python 決定論的多ホップ検索（テキスト PRF）設計

- 日付: 2026-06-06
- 対象 issue: #13（検索品質ハーネス）コメント https://github.com/was865/a-rag/issues/13#issuecomment-4636065649
- 背景: 先行の TS エージェント側 bridge 実装（ブランチ `feat/multihop-bridge-retrieval`）は、評価ハーネスが測る `retrieve_service`（単発・Python）を通らないため **eval で多ホップ回収を測定できない**ことが判明。issue の受け入れ項目「hotpot 多ホップを回収し回帰ターゲット化（ハーネスで測る）」を満たすには、多ホップを **eval が見える Python 検索層**に置く必要がある。よって TS 実装は revert（未マージのため main から再出発）し、本 spec の Python 実装に置き換える。

## ゴール

`rag/app/retrieval` に **LLM を使わない決定論的な多ホップ検索**（テキスト PRF）を実装し、`rag-eval-full` が hotpot の多ホップ回収を直接測定できるようにする。加えて本番 `/retrieve`・`/retrieve/stream` に opt-in フラグとして出し、アプリ（TS エージェント）も決定論的多ホップを使えるようにする。

## 制約

- **rag は LLM 生成を行わない**（CLAUDE.md のアーキテクチャ規約）。多ホップは決定論的でなければならない。
- **多言語・オフライン**（`HF_HUB_OFFLINE=1`）。NER 等のモデル依存は不可。
- 既定挙動を変えない（`multi_hop=False` で現行と完全一致）。

## 現状（確認済み）

- `rag/app/retrieval/service.py` の `retrieve_stream`/`retrieve`：scope → embed（BGE-M3 dense+sparse）→ dense/sparse 並行検索 → round-robin マージ → bge rerank → ±1 近傍 expand → `RetrievedChunk` 列。単発。
- 評価：`rag/eval/runner.py` の `run_suite(suite, retrieve_fn)`。`rag/eval/__main__.py` の `_cmd_run` が `retrieve_fn = retrieve_service(...)` を渡す（単発）。CI は `.github/workflows/rag-eval-full.yml` が `python -m eval run` を実行。

## アーキテクチャ判断

**テキスト PRF（Pseudo-Relevance Feedback）** を採用（ブレストで A を選択）。hop-1 の上位チャンク本文を元クエリへ連結して hop-2 を検索し、結果を RRF 融合する。橋渡しエンティティ（hop-1 本文中の固有名）がクエリに注入され、答えの doc が hop-2 で引ける。決定論的・多言語・オフライン安全で、連結テキストが dense（BGE-M3）と sparse（BM25）の**両方**に効く。

却下：B エンティティ抽出（正規表現＝英語限定/脆弱、NER＝オフラインモデル要）、C 埋め込み空間 PRF（dense のみ・デバッグ困難）。

### 発火条件：無条件（設計判断）

`multi_hop=True` のとき hop-2 は **hop-1 の品質で条件分岐せず常に実行**する（hop-1 が空・`max_hops=0`・PRF 拡張テキスト無し の些末スキップを除く）。理由：多ホップ**橋渡し**質問は **hop-1 が高スコア・1位確定なのに答えが別 doc にある**という性質（issue 例：湖は1位で取れるが答え＝郡を取り逃す＝MRR 1.0 でも recall 0.5）。よって rerank スコアや件数等の決定論シグナルで「hop-1 が弱いとき hop-2」とすると、**回収したい橋渡しケース（hop-1 高品質）をスキップ**してしまう。「hop-1 は自信があるが答えが欠けている」を LLM 無しで見抜く手段は無いため、PRF を常時適用するのが原理的に正しい。PRF は hop-1 結果を RRF で保持しつつ hop-2 候補を足すだけなので**常時適用しても安全寄り**。単発質問でのノイズ影響は beir(単発)+hotpot(多ホップ) の eval で実測して net プラスを確認する。学術的にも、推論駆動の条件分岐は LLM 側（エージェントの自発ループ＝IRCoT/agentic 相当）が担い、Python 側は決定論的な recall 補強（PRF）に徹する役割分担とする。本番 /retrieve のコスト（毎回2回検索）が問題化した場合の条件付き化は将来の最適化（範囲外）。

## ユニット分割

### 新規 `rag/app/retrieval/multihop.py`

`service.py` を肥大化させず単一責務の新モジュール。既存 `retrieve`/`retrieve_stream` を**ブラックボックスとして再利用**する。

#### `retrieve_multihop(...) -> list[RetrievedChunk]`（非ストリーム）

```
retrieve_multihop(session, store, embedder, reranker, *, query, owner_user_id,
                  top_k=6, candidate_k=DEFAULT_CANDIDATE_K,
                  document_ids=None, max_hops=1) -> list[RetrievedChunk]
```

手順:
1. `hop1 = retrieve(query, top_k, ...)`。
2. `hop1` が空、または `max_hops == 0` → `hop1` をそのまま返す（現行挙動）。
3. `prf = _prf_query(query, hop1)`。`prf == query`（拡張テキスト無し）なら hop-2 を行わず `hop1` を返す。
4. `hop2 = retrieve(prf, top_k, ...)`。
5. `return _rrf_fuse(hop1, hop2, top_k=top_k)`。

`max_hops` は将来の多段化の余地として持つが、本 spec の既定・実装は深さ1（hop-2 まで）。`>1` は hop-2 結果から再度 PRF して反復する（実装は1段でも `for` ループで一般化）。

#### `_prf_query(query: str, hop1: list[RetrievedChunk], *, n_docs=2, char_budget=200) -> str`

`query` の末尾に、`hop1` 上位 `n_docs` チャンクの `document_title`＋`heading_path`＋本文先頭 `char_budget` 文字を空白連結。本文は `expanded_text or text`。重複・空白は最小限に整形。純関数。

#### `_rrf_fuse(hop1, hop2, *, top_k, bridge_quota=2, rrf_k=60) -> list[RetrievedChunk]`

TS `fuse.ts` の移植。`chunk_id` で重複除去し、各リストの順位から RRF スコア `1/(rrf_k+rank)` を加算して降順整列、`top_k` 件に切り詰め。ただし `hop2` 上位で未採用のものを `bridge_quota` 枠だけ予約し、末尾を置換（橋渡しの答えがリランクで落ちるのを防ぐ）。`hop2` が空なら `hop1[:top_k]`。純関数。

#### `retrieve_multihop_stream(...)`（ストリーム）

`/retrieve/stream`（TS エージェントが使用）用のジェネレータ。
- `retrieve_stream(query)` を回し、`result` 以外の stage イベントを**そのまま中継**、`result` の chunks を `hop1` として捕捉（emit しない）。
- `hop1` 非空かつ `max_hops>0` なら `prf` を作り、`retrieve_stream(prf)` を回す。hop-2 の stage イベントは `{"hop": 2, ...}` を付与して中継（UI が多ホップを区別できるように）。`result` の chunks を `hop2` として捕捉。
- `_rrf_fuse(hop1, hop2)` を最終 `{"stage": "result", "chunks": ...}` として emit。
- `hop1` が空/`max_hops==0` の場合は hop-1 の `result` をそのまま emit（現行挙動）。

### 既存 `rag/app/retrieval/service.py`

変更なし（`retrieve`/`retrieve_stream` を再利用）。round-robin マージ等の内部は触らない。

## API / スキーマ統合

### `rag/app/schemas.py`

retrieve リクエストモデル（`/retrieve`・`/retrieve/stream` 共通）に追加:
```
multi_hop: bool = False
```

### `rag/app/main.py`

`/retrieve`・`/retrieve/stream` ハンドラで `req.multi_hop` を見て分岐:
- `True` → `retrieve_multihop` / `retrieve_multihop_stream`
- `False`（既定）→ 現行の `retrieve` / `retrieve_stream`（**挙動不変**）

### TS `src/lib/rag-client.ts` / `retrieve-client.ts`

`multi_hop` を渡せるよう**最小限**のオプション追加（既定で未送出＝false）。TS エージェントが既定 ON にするかは本 spec の範囲外（別途判断）。

## eval 統合 + 回帰

### `rag/eval/__main__.py`

`run` サブパーサに `--multi-hop`（`action="store_true"`）を追加。指定時、`retrieve_fn` を:
```
def retrieve_fn(query, owner, top_k):
    return retrieve_multihop(session, store, embedder, reranker,
                             query=query, owner_user_id=owner, top_k=top_k)
```
に差し替える（既定は現行 `retrieve_service`）。

### baseline / gate

- hotpot 用に multi-hop baseline JSON を生成・commit（例 `rag/eval/suites/hotpot_dev/baselines/bge-m3__bge__multihop.json`）。
- `--multi-hop` 実行時はこの baseline と差分比較・gate する（`_resolve_baseline` を multi-hop 用に切替）。
- これにより **rag-eval-full が多ホップ回収を測定**し、hotpot の3件回収が回帰ターゲットになる。single vs multi の差分も出せる。

### `.github/workflows/rag-eval-full.yml`

hotpot suite に対し `--multi-hop` 実行を追加（single と並走、または hotpot のみ multi）。具体の workflow 変更は plan で確定。

## エラー処理 / 既定挙動

- hop-2 の `retrieve` が例外時は hop-1 結果で続行（多ホップは品質向上のベストエフォート）。
- `multi_hop=False`・`max_hops=0`・hop-1 空・PRF 拡張テキスト無し のいずれでも**現行と完全一致の結果**。

## テスト計画（GPU/モデル不要）

内側の `retrieve`/`retrieve_stream` を monkeypatch でスタブ化し、CPU 完結で検証（`rag/tests/`、共有 DB 非依存）:
- `test_multihop.py`
  - `_prf_query`: 上位 n_docs の連結・char_budget 切り詰め・空 hop1 で原クエリ返し。
  - `_rrf_fuse`: RRF 順位・重複除去・bridge_quota 予約・hop2 空時の素通し（`fuse.test.ts` 相当）。
  - `retrieve_multihop`: スタブ retrieve が「hop-1=湖 doc（答えなし）/ PRF クエリ=郡 doc（答えあり）」を返す筋書きで、融合結果に郡 doc が含まれること。`max_hops=0` で hop-2 を呼ばないこと。
  - `retrieve_multihop_stream`: hop-1 stage 中継 → hop-2 stage に `hop=2` 付与 → 最終 result が融合結果。
- 実 recall@k / fact_coverage の改善測定のみ GPU eval（`rag-eval-full`）。

## 範囲外（明示）

- TS エージェントを `multi_hop` 既定 ON にする判断。
- gate 閾値の実測引き上げ・baseline 全 suite commit（issue 残タスク D の別作業。本 spec は hotpot multi-hop baseline のみ）。
- beir_scifact の完全ミス対策・画像 grounding（別サブプロジェクト B/C）。
- 旧 TS ブランチ `feat/multihop-bridge-retrieval` の削除（履歴として残置、破棄は別途許可制）。
