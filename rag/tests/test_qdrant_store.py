import uuid

from app.embedding.base import DenseSparse
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
