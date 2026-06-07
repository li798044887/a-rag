import importlib

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


def teardown_module(module):
    # 他テストへ影響しないよう既定状態へ戻す。
    import app.config as config
    importlib.reload(config)
