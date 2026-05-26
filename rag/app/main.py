import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import documents, jobs, retrieve

_state = {"models_loaded": False}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_MODELS") == "1" and settings.embedder != "stub":
        from app.embedding.factory import get_embedder
        from app.reranker.factory import get_reranker
        get_embedder()
        get_reranker()
        _state["models_loaded"] = True
    yield


app = FastAPI(title="ARag RAG service", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(jobs.router)
app.include_router(retrieve.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": settings.device, "models_loaded": _state["models_loaded"]}
