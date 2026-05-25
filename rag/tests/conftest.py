import os
import tempfile

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
