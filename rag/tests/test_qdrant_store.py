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
            "document_id": "doc1",
            "owner_user_id": "user1",
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


def _split_row(e, text, owner="u1", doc="d1"):
    return {
        "chunk_id": str(uuid.uuid4()), "document_id": doc, "owner_user_id": owner,
        "heading_path": "H", "page_start": 0, "page_end": 0, "block_type": "text",
        "source_type": "doc", "text": text, "vector": e.embed([text])[0],
    }


def test_dense_and_sparse_search_filter_owner():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SPLIT_COLL, dim=8)
    store.ensure_collection()
    store.upsert([_split_row(e, "認証トークンの失効", owner="u1"),
                  _split_row(e, "他人の文書", owner="u2")])
    qv = e.embed(["認証トークンの失効"])[0]

    dense = store.dense_search(qv.dense, owner_user_id="u1", limit=10)
    sparse = store.sparse_search(qv.sparse, owner_user_id="u1", limit=10)

    assert len(dense) == 1
    assert len(sparse) == 1
    assert all(h["owner_user_id"] == "u1" for h in dense)   # u2 は除外
    assert all(h["owner_user_id"] == "u1" for h in sparse)
    assert all("chunk_id" in h and "text" in h and "score" in h for h in dense)
    assert all("chunk_id" in h and "text" in h and "score" in h for h in sparse)
    store.drop()


_SCOPE_COLL = "test_scope_" + uuid.uuid4().hex[:8]


def test_dense_and_sparse_search_filter_document_ids():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=_SCOPE_COLL, dim=8)
    store.ensure_collection()
    store.upsert([_split_row(e, "添付された設計メモ", owner="u1", doc="docA"),
                  _split_row(e, "別の社内資料", owner="u1", doc="docB")])
    qv = e.embed(["設計メモ"])[0]

    dense = store.dense_search(qv.dense, owner_user_id="u1", limit=10, document_ids=["docA"])
    sparse = store.sparse_search(qv.sparse, owner_user_id="u1", limit=10, document_ids=["docA"])
    assert len(dense) == 1 and dense[0]["document_id"] == "docA"
    assert len(sparse) == 1 and sparse[0]["document_id"] == "docA"

    dense_all = store.dense_search(qv.dense, owner_user_id="u1", limit=10)
    assert len(dense_all) == 2
    store.drop()
