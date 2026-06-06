from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://arag:arag@localhost:5432/arag"
    qdrant_url: str = "http://localhost:6333"
    redis_url: str = "redis://localhost:6379"
    # "auto"（既定）なら CUDA の有無で cuda/cpu を自動判定。"cpu"/"cuda" を明示すれば強制。
    # embedder / reranker / MinerU / OCR / worker 並列数すべてがこの値に追従する。
    device: str = "auto"
    embedder: str = "bge-m3"
    reranker: str = "bge"
    rag_internal_token: str = "dev-internal-token"
    upload_dir: str = "/data/uploads"
    # 空なら embedder からコレクション名を導出（バージョニング: モデル毎に別コレクション）。
    qdrant_collection: str = ""
    # MinerU パースバックエンド。dev/CPU は "pipeline"、prod/CUDA は "hybrid-auto-engine"。
    # hybrid/vlm は VLM(MinerU2.5) + vllm を要し GPU 前提。
    parse_backend: str = Field(default="pipeline", validation_alias="MINERU_BACKEND")

    @field_validator("device")
    @classmethod
    def _resolve_device(cls, v: str) -> str:
        """"auto"/空なら CUDA の有無で解決する。明示指定された cpu/cuda はそのまま尊重。"""
        v = (v or "auto").strip().lower()
        if v != "auto":
            return v
        try:
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    @field_validator("parse_backend")
    @classmethod
    def _check_parse_backend(cls, v: str) -> str:
        """許容するバックエンドのみ通す。"""
        v = v.strip()
        allowed = {"pipeline", "hybrid-auto-engine", "vlm-auto-engine"}
        if v not in allowed:
            raise ValueError(
                f"MINERU_BACKEND は {sorted(allowed)} のいずれか。受領: {v!r}"
            )
        return v


settings = Settings()
