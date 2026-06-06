import app.main as main_module


def test_vlm_preload_invoked_for_hybrid(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.settings, "parse_backend", "hybrid-auto-engine")
    monkeypatch.setattr(main_module, "_fetch_vlm_model",
                        lambda: calls.append("fetch"))
    main_module._maybe_preload_vlm()
    assert calls == ["fetch"]


def test_vlm_preload_skipped_for_pipeline(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module.settings, "parse_backend", "pipeline")
    monkeypatch.setattr(main_module, "_fetch_vlm_model",
                        lambda: calls.append("fetch"))
    main_module._maybe_preload_vlm()
    assert calls == []
