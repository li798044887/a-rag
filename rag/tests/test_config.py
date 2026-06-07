import importlib
import warnings

import pytest


def _fresh_settings(monkeypatch, **env):
    """env を差し替えて Settings を再評価して返す。"""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.config as config
    importlib.reload(config)
    return config


def test_parse_backend_defaults_to_pipeline(monkeypatch):
    monkeypatch.delenv("MINERU_BACKEND", raising=False)
    config = _fresh_settings(monkeypatch)
    assert config.settings.parse_backend == "pipeline"


def test_parse_backend_accepts_hybrid(monkeypatch):
    config = _fresh_settings(monkeypatch, MINERU_BACKEND="hybrid-auto-engine")
    assert config.settings.parse_backend == "hybrid-auto-engine"


def test_parse_backend_rejects_unknown(monkeypatch):
    monkeypatch.setenv("MINERU_BACKEND", "bogus-backend")
    with pytest.raises(ValueError, match="MINERU_BACKEND"):
        _fresh_settings(monkeypatch)


def test_parse_backend_accepts_vlm(monkeypatch):
    config = _fresh_settings(monkeypatch, MINERU_BACKEND="vlm-auto-engine")
    assert config.settings.parse_backend == "vlm-auto-engine"


def test_production_rejects_default_internal_token(monkeypatch):
    """APP_ENV=production で dev 既定トークンのままなら起動を止める。"""
    monkeypatch.setenv("RAG_INTERNAL_TOKEN", "dev-internal-token")
    with pytest.raises(ValueError, match="RAG_INTERNAL_TOKEN"):
        _fresh_settings(monkeypatch, APP_ENV="production")


def test_production_accepts_custom_internal_token(monkeypatch):
    """本番でも強い値を設定していれば通る。"""
    config = _fresh_settings(
        monkeypatch, APP_ENV="production", RAG_INTERNAL_TOKEN="s3cret-random-value"
    )
    assert config.settings.rag_internal_token == "s3cret-random-value"


def test_dev_default_internal_token_warns_but_starts(monkeypatch):
    """dev は従来どおり既定トークンで起動可。ただし警告は出す。"""
    monkeypatch.setenv("RAG_INTERNAL_TOKEN", "dev-internal-token")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        config = _fresh_settings(monkeypatch, APP_ENV="dev")
    assert config.settings.rag_internal_token == "dev-internal-token"
    assert any("RAG_INTERNAL_TOKEN" in str(w.message) for w in caught)


def teardown_module(module):
    # 他テストへ影響しないよう既定状態へ戻す。
    import app.config as config
    importlib.reload(config)
