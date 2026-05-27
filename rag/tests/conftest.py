import os
import tempfile

# a-rag の Postgres は docker-compose.override.yml によりホスト側 5433 に割り当てられている
# （他プロジェクトが host:5432 を使うため）。ホストから走る pytest はこの 5433 を指す必要がある。
# app（= app.db のエンジン生成）を import する前に既定値を設定する。実 env var があればそれを優先。
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://arag:arag@localhost:5433/arag")

import pytest
from fastapi.testclient import TestClient

from app.main import app

TOKEN = "dev-internal-token"


@pytest.fixture(autouse=True)
def tmp_upload_dir(tmp_path, monkeypatch):
    """Override upload_dir to a writable temp dir for all tests."""
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    # reload settings so the env var takes effect
    from app import config
    config.settings.upload_dir = str(tmp_path / "uploads")
    yield
    config.settings.upload_dir = "/data/uploads"


@pytest.fixture
def client():
    return TestClient(app)
