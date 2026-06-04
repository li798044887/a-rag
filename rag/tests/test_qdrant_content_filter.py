import uuid

from app.embedding.base import DenseSparse
from app.vectorstore.qdrant import QdrantStore


def _row(chunk_id, content_hash, text):
    return {
        "chunk_id": chunk_id, "content_hash": content_hash, "heading_path": "",
        "page_start": 0, "page_end": 0, "block_type": "text", "source_type": "doc",
        "text": text,
        "vector": DenseSparse(dense=[0.1] * 8, sparse={1: 0.5}),
    }


def test_dense_search_filters_by_content_hashes():
    coll = "test_cf_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    store.ensure_collection()
    ha, hb = "ha_" + uuid.uuid4().hex, "hb_" + uuid.uuid4().hex
    ca, cb = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        store.upsert([_row(ca, ha, "A の本文"), _row(cb, hb, "B の本文")])
        # ha だけを許可 → ca のみ返る
        hits = store.dense_search([0.1] * 8, [ha], limit=10)
        ids = {h["chunk_id"] for h in hits}
        assert ca in ids and cb not in ids
        # 空集合 → 何も返らない
        assert store.dense_search([0.1] * 8, [], limit=10) == []
    finally:
        store.drop()


def test_delete_by_content_removes_only_that_content():
    coll = "test_cf_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    store.ensure_collection()
    ha, hb = "ha_" + uuid.uuid4().hex, "hb_" + uuid.uuid4().hex
    try:
        store.upsert([_row(str(uuid.uuid4()), ha, "A"), _row(str(uuid.uuid4()), hb, "B")])
        store.delete_by_content(ha)
        assert store.dense_search([0.1] * 8, [ha], limit=10) == []
        assert len(store.dense_search([0.1] * 8, [hb], limit=10)) == 1
    finally:
        store.drop()
