import warnings

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# web↔rag 内部認証トークンの dev 既定値。本番でこの値のまま起動するのは禁止。
DEV_INTERNAL_TOKEN = "dev-internal-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://arag:arag@localhost:5432/arag"
    qdrant_url: str = "http://localhost:6333"
    redis_url: str = "redis://localhost:6379"
    # 実行環境。"production"（または "prod"）のとき内部トークンの dev 既定使用を拒否する。
    app_env: str = "dev"
    # "auto"（既定）なら CUDA の有無で cuda/cpu を自動判定。"cpu"/"cuda" を明示すれば強制。
    # embedder / reranker / MinerU / OCR / worker 並列数すべてがこの値に追従する。
    device: str = "auto"
    embedder: str = "bge-m3"
    reranker: str = "bge"
    # web↔rag 内部認証の共有シークレット。rag は本トークンを持つ呼び出し元（web）を
    # 信頼し owner_user_id をそのまま受け入れるため、本番は必ず強い値へ差し替える。
    rag_internal_token: str = DEV_INTERNAL_TOKEN
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

    @model_validator(mode="after")
    def _guard_internal_token(self) -> "Settings":
        """内部トークンが dev 既定のままなら、本番は起動を止め dev は警告する。"""
        if self.rag_internal_token != DEV_INTERNAL_TOKEN:
            return self
        if self.app_env.strip().lower() in {"prod", "production"}:
            raise ValueError(
                "RAG_INTERNAL_TOKEN が dev 既定値のままです。"
                "APP_ENV=production では強いランダム値を設定してください。"
            )
        warnings.warn(
            "RAG_INTERNAL_TOKEN が dev 既定値（dev-internal-token）です。"
            "本番では必ず差し替えてください。",
            stacklevel=2,
        )
        return self


settings = Settings()
