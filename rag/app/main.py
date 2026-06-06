import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import documents, jobs, retrieve

_state = {"models_loaded": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_MODELS") == "1" and settings.embedder != "stub":
        # preload は best-effort。失敗してもコンテナは落とさず /health は up を返す。
        # models_loaded は False のまま残り、リクエスト時に遅延ロードを再試行できる。
        try:
            from app.embedding.factory import get_embedder
            from app.reranker.factory import get_reranker
            get_embedder()
            get_reranker()
            _state["models_loaded"] = True
        except Exception as exc:  # noqa: BLE001
            print(f"[lifespan] model preload failed, continuing with lazy load: {exc}")
        # OCR モデルも他モデルと同様に事前取得し、共有 modelcache へ落とす（worker が再利用）。
        # best-effort: 失敗しても models_loaded は維持し、worker 側で遅延ロードを再試行する。
        try:
            from app.parsing.ocr import _build_ocr
            _build_ocr()
        except Exception as exc:  # noqa: BLE001
            print(f"[lifespan] OCR preload failed, will lazy-load in worker: {exc}")
    yield


app = FastAPI(title="ARag RAG service", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(jobs.router)
app.include_router(retrieve.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": settings.device, "models_loaded": _state["models_loaded"]}
