from app.config import settings


class BGEReranker:
    def __init__(self):
        from FlagEmbedding import FlagReranker
        self.model = FlagReranker("BAAI/bge-reranker-v2-m3",
                                  use_fp16=settings.device == "cuda", device=settings.device)

    def score(self, query: str, docs: list[str]) -> list[float]:
        if not docs:
            return []
        scores = self.model.compute_score([[query, d] for d in docs], normalize=True)
        return [float(s) for s in (scores if isinstance(scores, list) else [scores])]
