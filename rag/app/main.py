import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import settings
from app.routers import documents, jobs, retrieve

_state = {"models_loaded": False}

_VLM_BACKENDS = {"hybrid-auto-engine", "vlm-auto-engine"}


def _fetch_vlm_model() -> None:
    """MinerU VLM 重み(MinerU2.5)を modelcache へ取得する。

    初回はオンライン取得、以降は HF_HUB_OFFLINE=1 でキャッシュから読む。
    pipeline(dev/CPU) では呼ばれないため modelscope/vllm 依存も読み込まれない。
    """
    from mineru.utils.models_download_utils import auto_download_and_get_model_root_path
    auto_download_and_get_model_root_path("/", "vlm")


def _maybe_preload_vlm() -> None:
    if settings.parse_backend not in _VLM_BACKENDS:
        return
    try:
        _fetch_vlm_model()
    except Exception as exc:  # noqa: BLE001
        print(f"[lifespan] VLM model preload failed, will lazy-load in worker: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("PRELOAD_MODELS") == "1" and settings.embedder != "stub":
        # preload は best-effort。失敗してもコンテナは落とさず /health は up を返す。
        try:
            from app.embedding.factory import get_embedder
            from app.reranker.factory import get_reranker
            get_embedder()
            get_reranker()
            _state["models_loaded"] = True
        except Exception as exc:  # noqa: BLE001
            print(f"[lifespan] model preload failed, continuing with lazy load: {exc}")
        # VLM 系バックエンド時のみ MinerU2.5 を事前取得（pipeline では何もしない）。
        _maybe_preload_vlm()
    yield


app = FastAPI(title="ARag RAG service", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(jobs.router)
app.include_router(retrieve.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": settings.device, "models_loaded": _state["models_loaded"]}
