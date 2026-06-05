from app.config import settings
from app.vectorstore.qdrant import QdrantStore, default_collection_name


def test_default_collection_name_includes_embedder():
    assert default_collection_name() == f"arag_chunks__{settings.embedder}"


def test_store_uses_versioned_default_collection():
    store = QdrantStore(dim=8)
    assert store.collection == f"arag_chunks__{settings.embedder}"


def test_explicit_collection_overrides_default():
    store = QdrantStore(collection="explicit_x", dim=8)
    assert store.collection == "explicit_x"
