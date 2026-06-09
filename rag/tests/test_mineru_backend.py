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

    doc = mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))

    assert "-b" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-b") + 1] == "hybrid-auto-engine"
    # device は env(MINERU_DEVICE_MODE)/auto 検出で決まる。MinerU CLI は未知オプションを
    # 黙殺する（no-op）ため -d は渡さない。
    assert "-d" not in captured["cmd"]
    assert any(b.type == "text" and b.text == "本文" for b in doc.blocks)


def test_parse_extracts_hybrid_figure_text_as_text_block(tmp_path, monkeypatch):
    """hybrid VLM が画像から抽出した図表テキスト(image_caption + content)を、
    索引対象の text ブロックとして展開する（image チャンクは索引除外のため）。"""
    items = [
        {"type": "image", "img_path": "images/a.jpg",
         "image_caption": ["図1: 冷却ライン CL-2", "⾚枠はV-12バイパス弁を⽰す"],
         "image_footnote": [],
         "content": "```mermaid\ngraph LR\n A[\"HX-7\"] --> B[\"V-12\"]\n```",
         "sub_type": "flowchart", "page_idx": 2},
    ]

    def fake_run(cmd, check):
        _write_content_list(str(tmp_path / "out"), items)

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "hybrid-auto-engine")
    monkeypatch.setattr(mineru.settings, "device", "cuda")

    doc = mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))

    # 画像ブロックは表示用に残り、caption は image_caption から取り込む。
    imgs = [b for b in doc.blocks if b.type == "image"]
    assert len(imgs) == 1
    assert imgs[0].page == 2
    assert "V-12バイパス弁" in (imgs[0].caption or "")
    # 図表テキストは索引対象の text ブロックとして展開され、caption と content(mermaid) の双方を含む。
    figtexts = [b for b in doc.blocks if b.type == "text"]
    assert any("V-12バイパス弁" in b.text and "HX-7" in b.text for b in figtexts)
    assert all(b.page == 2 for b in figtexts)


def test_parse_decorative_image_emits_no_text_block(tmp_path, monkeypatch):
    """caption も content も無い装飾画像（pipeline 経路など）は text ブロックを足さない。"""
    items = [
        {"type": "image", "img_path": "images/a.jpg",
         "image_caption": [], "image_footnote": [], "page_idx": 0},
    ]

    def fake_run(cmd, check):
        _write_content_list(str(tmp_path / "out"), items)

    monkeypatch.setattr(mineru.subprocess, "run", fake_run)
    monkeypatch.setattr(mineru.settings, "parse_backend", "pipeline")

    doc = mineru.parse(str(tmp_path / "in.pdf"), str(tmp_path / "out"))

    assert any(b.type == "image" for b in doc.blocks)
    assert all(b.type != "text" for b in doc.blocks)


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
