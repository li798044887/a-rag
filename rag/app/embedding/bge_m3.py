import threading

from app.config import settings
from app.embedding.base import DenseSparse


class BGEM3Embedder:
    dim = 1024

    def __init__(self):
        from FlagEmbedding import BGEM3FlagModel
        use_fp16 = settings.device == "cuda"
        self.model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=use_fp16, device=settings.device)
        self.name = "BAAI/bge-m3"
        # PyTorch + HuggingFace fast tokenizer はスレッド非安全。同期 (def) ルートは
        # スレッドプールで実行されるため、並列 retrieve から同時推論されると 2 件目が落ちる。直列化する。
        self._lock = threading.Lock()

    def embed(self, texts: list[str]) -> list[DenseSparse]:
        with self._lock:
            out = self.model.encode(texts, return_dense=True, return_sparse=True)
        dense = out["dense_vecs"]
        sparse = out["lexical_weights"]
        return [
            DenseSparse(
                dense=[float(x) for x in dense[i]],
                sparse={int(k): float(v) for k, v in sparse[i].items()},
            )
            for i in range(len(texts))
        ]
