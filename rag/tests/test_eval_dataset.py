import textwrap

import pytest

from eval.dataset import GoldenSuite, load_suite


def _write(tmp_path, body: str):
    p = tmp_path / "golden.yaml"
    p.write_text(textwrap.dedent(body), encoding="utf-8")
    return p


def test_load_suite_parses_cases(tmp_path):
    path = _write(tmp_path, """
        suite: demo
        owner_user_id: __eval__
        files_dir: /data/eval-assets/demo
        documents:
          - a.pdf
          - b.pdf
        thresholds:
          recall_at_5: 0.8
          fact_coverage: 0.75
        cases:
          - id: c1
            query: "なに？"
            top_k: 6
            tags: ["demo", "ja"]
            relevant_documents: [a.pdf]
            key_facts:
              - any: ["AlphaGate X2", "AlphaGate"]
      """)
    suite = load_suite(path)
    assert isinstance(suite, GoldenSuite)
    assert suite.owner_user_id == "__eval__"
    assert suite.files_dir == "/data/eval-assets/demo"
    assert suite.cases[0].id == "c1"
    assert suite.cases[0].tags == ["demo", "ja"]
    assert suite.cases[0].rewritten is None
    assert suite.cases[0].key_facts[0].any == ["AlphaGate X2", "AlphaGate"]
    assert suite.thresholds.recall_at_5 == 0.8


def test_relevant_documents_must_be_subset(tmp_path):
    path = _write(tmp_path, """
        suite: demo
        owner_user_id: __eval__
        documents: [a.pdf]
        cases:
          - id: c1
            query: "x"
            relevant_documents: [missing.pdf]
      """)
    with pytest.raises(ValueError, match="missing.pdf"):
        load_suite(path)
