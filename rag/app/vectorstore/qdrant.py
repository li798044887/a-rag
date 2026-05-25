from qdrant_client import QdrantClient, models

from app.config import settings
from app.embedding.base import DenseSparse

DENSE = "dense"
SPARSE = "lexical"


class QdrantStore:
    def __init__(self, collection: str = "arag_chunks", dim: int = 1024):
        self.collection = collection
        self.dim = dim
        self.client = QdrantClient(url=settings.qdrant_url)

    def ensure_collection(self) -> None:
        if self.client.collection_exists(self.collection):
            return
        self.client.create_collection(
            self.collection,
            vectors_config={DENSE: models.VectorParams(size=self.dim, distance=models.Distance.COSINE)},
            sparse_vectors_config={SPARSE: models.SparseVectorParams()},
        )

    def upsert(self, rows: list[dict]) -> None:
        points = []
        for r in rows:
            vec: DenseSparse = r["vector"]
            payload = {k: r[k] for k in (
                "chunk_id", "document_id", "owner_user_id", "heading_path",
                "page_start", "page_end", "block_type", "source_type", "text",
            )}
            points.append(models.PointStruct(
                id=r["chunk_id"],
                vector={
                    DENSE: vec.dense,
                    SPARSE: models.SparseVector(
                        indices=list(vec.sparse.keys()),
                        values=list(vec.sparse.values()),
                    ),
                },
                payload=payload,
            ))
        self.client.upsert(self.collection, points=points)

    def count(self) -> int:
        return self.client.count(self.collection).count

    def hybrid_search(self, query_vec: DenseSparse, owner_user_id: str, limit: int = 40) -> list[dict]:
        if not self.client.collection_exists(self.collection):
            return []
        flt = models.Filter(must=[models.FieldCondition(
            key="owner_user_id", match=models.MatchValue(value=owner_user_id))])
        res = self.client.query_points(
            self.collection,
            prefetch=[
                models.Prefetch(query=query_vec.dense, using=DENSE, limit=limit, filter=flt),
                models.Prefetch(
                    query=models.SparseVector(
                        indices=list(query_vec.sparse.keys()),
                        values=list(query_vec.sparse.values())),
                    using=SPARSE, limit=limit, filter=flt),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
            with_payload=True,
        )
        out = []
        for p in res.points:
            payload = dict(p.payload or {})
            payload["score"] = p.score
            out.append(payload)
        return out

    def drop(self) -> None:
        self.client.delete_collection(self.collection)
