import json

import app.parsing.mineru as mineru


def _write_content_list(out_dir, items):
    import pathlib
    p = pathlib.Path(out_dir) / "doc" / "auto"
    p.mkdir(parents=True, exist_ok=True)
    (p / "x_content_list.json").write_text(json.dumps(items), encoding="utf-8")


def test_parse_passes_configured_backend(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, check):
        captured["cmd"] = cmd
        _write_content_list(str(tmp_path / "out"),
                            [{"type": "text", "text": "本文", "page_idx": 0}])

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "hybrid-auto-engine")
    monkeypatch.setattr(mineru.settings, "device", "cuda")

    doc = mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))

    assert "-b" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-b") + 1] == "hybrid-auto-engine"
    assert "-d" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-d") + 1] == "cuda"
    assert any(b.type == "text" and b.text == "本文" for b in doc.blocks)


def test_parse_defaults_to_pipeline_backend(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, check):
        captured["cmd"] = cmd
        _write_content_list(str(tmp_path / "out"),
                            [{"type": "text", "text": "x", "page_idx": 0}])

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "pipeline")

    mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))
    assert captured["cmd"][captured["cmd"].index("-b") + 1] == "pipeline"
