import uuid

from app.embedding.base import DenseSparse
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore

COLL = "test_arag_" + uuid.uuid4().hex[:8]


def test_ensure_collection_and_upsert_then_count():
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    store.upsert([
        {
            "chunk_id": str(uuid.uuid4()),
            "content_hash": "h_" + uuid.uuid4().hex,
            "heading_path": "A > B",
            "page_start": 0, "page_end": 0,
            "block_type": "text",
            "source_type": "doc",
            "text": "hello",
            "vector": DenseSparse(dense=[0.1] * 8, sparse={1: 0.5, 2: 0.3}),
        }
    ])
    assert store.count() == 1
    store.drop()


_SPLIT_COLL = "test_split_" + uuid.uuid4().hex[:8]


def _split_row(e, text, content_hash):
    return {
        "chunk_id": str(uuid.uuid4()), "content_hash": content_hash,
        "heading_path": "H", "page_start": 0, "page_end": 0, "block_type": "text",
        "source_type": "doc", "text": text, "vector": e.embed([text])[0],
    }


def test_dense_and_sparse_search_filter_content_hash():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SPLIT_COLL, dim=8)
    store.ensure_collection()
    ha, hb = "h_" + uuid.uuid4().hex, "h_" + uuid.uuid4().hex
    store.upsert([_split_row(e, "認証トークンの失効", content_hash=ha),
                  _split_row(e, "他人の文書", content_hash=hb)])
    qv = e.embed(["認証トークンの失効"])[0]

    dense = store.dense_search(qv.dense, [ha], limit=10)
    sparse = store.sparse_search(qv.sparse, [ha], limit=10)

    assert len(dense) == 1
    assert len(sparse) == 1
    assert all(h["content_hash"] == ha for h in dense)   # hb は除外
    assert all(h["content_hash"] == ha for h in sparse)
    assert all("chunk_id" in h and "text" in h and "score" in h for h in dense)
    assert all("chunk_id" in h and "text" in h and "score" in h for h in sparse)
    store.drop()


_SCOPE_COLL = "test_scope_" + uuid.uuid4().hex[:8]


def test_dense_and_sparse_search_scope_to_content_subset():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SCOPE_COLL, dim=8)
    store.ensure_collection()
    ha, hb = "h_" + uuid.uuid4().hex, "h_" + uuid.uuid4().hex
    store.upsert([_split_row(e, "添付された設計メモ", content_hash=ha),
                  _split_row(e, "別の社内資料", content_hash=hb)])
    # StubEmbedder のスパースは文字列全体ハッシュ由来で部分一致では指標が重ならない。
    # スコープ絞り込みの検証が目的なので保存テキストと一致させて確実にヒットさせる。
    qv = e.embed(["添付された設計メモ"])[0]

    dense = store.dense_search(qv.dense, [ha], limit=10)
    sparse = store.sparse_search(qv.sparse, [ha], limit=10)
    assert len(dense) == 1 and dense[0]["content_hash"] == ha
    assert len(sparse) == 1 and sparse[0]["content_hash"] == ha

    dense_all = store.dense_search(qv.dense, [ha, hb], limit=10)
    assert len(dense_all) == 2
    store.drop()
