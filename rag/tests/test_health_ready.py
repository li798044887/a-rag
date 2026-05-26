from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_device_and_readiness():
    with TestClient(app) as client:
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert "device" in body
        assert "models_loaded" in body
