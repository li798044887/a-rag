import uuid

from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore

COLL = "test_hybrid_" + uuid.uuid4().hex[:8]


def _row(store, e, text, owner="u1", doc="d1"):
    v = e.embed([text])[0]
    return {
        "chunk_id": str(uuid.uuid4()), "document_id": doc, "owner_user_id": owner,
        "heading_path": "H", "page_start": 0, "page_end": 0, "block_type": "text",
        "source_type": "doc", "text": text, "vector": v,
    }


def test_hybrid_search_filters_owner_and_ranks():
    e = StubEmbedder(dim=8)
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    store.upsert([_row(store, e, "認証トークンの失効", owner="u1"),
                  _row(store, e, "請求書の発行", owner="u1"),
                  _row(store, e, "他人の文書", owner="u2")])

    qv = e.embed(["認証トークンの失効"])[0]
    hits = store.hybrid_search(qv, owner_user_id="u1", limit=10)
    assert all(h["owner_user_id"] == "u1" for h in hits)   # u2 は除外
    assert hits[0]["text"] == "認証トークンの失効"          # 完全一致が上位
    store.drop()
