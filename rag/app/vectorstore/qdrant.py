from qdrant_client import QdrantClient, models
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.embedding.base import DenseSparse

DENSE = "dense"
SPARSE = "lexical"


class QdrantStore:
    def __init__(self, collection: str = "arag_chunks", dim: int = 1024):
        self.collection = collection
        self.dim = dim
        self.client = QdrantClient(url=settings.qdrant_url, timeout=30)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def ensure_collection(self) -> None:
        if self.client.collection_exists(self.collection):
            return
        self.client.create_collection(
            self.collection,
            vectors_config={DENSE: models.VectorParams(size=self.dim, distance=models.Distance.COSINE)},
            sparse_vectors_config={SPARSE: models.SparseVectorParams()},
        )
        # content_hash の MatchAny を効率化する payload index。
        self.client.create_payload_index(
            self.collection, field_name="content_hash",
            field_schema=models.PayloadSchemaType.KEYWORD)

    def upsert(self, rows: list[dict]) -> None:
        points = []
        for r in rows:
            vec: DenseSparse = r["vector"]
            payload = {k: r[k] for k in (
                "chunk_id", "content_hash", "heading_path",
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

    def _scope_filter(self, content_hashes: list[str]) -> models.Filter:
        return models.Filter(must=[models.FieldCondition(
            key="content_hash", match=models.MatchAny(any=list(content_hashes)))])

    @staticmethod
    def _payloads(res) -> list[dict]:
        out = []
        for p in res.points:
            payload = dict(p.payload or {})
            payload["score"] = p.score
            out.append(payload)
        return out

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def dense_search(self, query_dense: list[float], content_hashes: list[str],
                     limit: int = 40) -> list[dict]:
        if not content_hashes or not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection, query=query_dense, using=DENSE, limit=limit,
            query_filter=self._scope_filter(content_hashes), with_payload=True)
        return self._payloads(res)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def sparse_search(self, query_sparse: dict[int, float], content_hashes: list[str],
                      limit: int = 40) -> list[dict]:
        if not content_hashes or not self.client.collection_exists(self.collection):
            return []
        res = self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=list(query_sparse.keys()), values=list(query_sparse.values())),
            using=SPARSE, limit=limit,
            query_filter=self._scope_filter(content_hashes), with_payload=True)
        return self._payloads(res)

    def delete_by_content(self, content_hash: str) -> None:
        if not self.client.collection_exists(self.collection):
            return
        self.client.delete(self.collection, points_selector=models.FilterSelector(
            filter=models.Filter(must=[models.FieldCondition(
                key="content_hash", match=models.MatchValue(value=content_hash))])))

    def drop(self) -> None:
        self.client.delete_collection(self.collection)
