import threading

from app.config import settings


class BGEReranker:
    def __init__(self):
        from FlagEmbedding import FlagReranker
        self.model = FlagReranker("BAAI/bge-reranker-v2-m3",
                                  use_fp16=settings.device == "cuda", device=settings.device)
        self.name = "BAAI/bge-reranker-v2-m3"
        # スレッド非安全なモデルへの同時推論を防ぐ（BGEM3Embedder と同じ理由）。
        self._lock = threading.Lock()

    def score(self, query: str, docs: list[str]) -> list[float]:
        if not docs:
            return []
        with self._lock:
            scores = self.model.compute_score([[query, d] for d in docs], normalize=True)
        return [float(s) for s in (scores if isinstance(scores, list) else [scores])]
