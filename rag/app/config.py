from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://arag:arag@localhost:5432/arag"
    qdrant_url: str = "http://localhost:6333"
    redis_url: str = "redis://localhost:6379"
    device: str = "cpu"
    embedder: str = "bge-m3"
    reranker: str = "bge"
    rag_internal_token: str = "dev-internal-token"
    upload_dir: str = "/data/uploads"
    ocr_lang: str = "ch"


settings = Settings()
