import gzip
import json
from pathlib import Path

from eval.dataset import Thresholds, load_suite
from eval.hotpot import (
    HotpotConfig,
    build_hotpot_suite,
    load_hotpot_config,
    prepare_hotpot_suite,
)

_SUITE_YAML = Path(__file__).resolve().parents[1] / "eval/suites/hotpot_dev/suite.yaml"


def _config(**overrides):
    base = dict(
        suite="hotpot_test",
        split="dev",
        source_url="unused",
        owner_user_id="__eval_hotpot_test__",
        thresholds=Thresholds(recall_at_5=0.5, fact_coverage=0.5),
        query_limit=None,
    )
    base.update(overrides)
    return HotpotConfig(**base)


def _record(_id, question, answer, type_="bridge"):
    return {
        "_id": _id,
        "question": question,
        "answer": answer,
        "type": type_,
        "supporting_facts": [["Alpha", 0], ["Beta", 0]],
        "context": [
            ["Alpha", ["Alpha is a thing.", "More alpha."]],
            ["Beta", ["Beta relates to Alpha."]],
            ["Distractor", ["Unrelated text."]],
        ],
    }


def test_build_hotpot_suite_basic(tmp_path):
    records = [_record("q1", "What relates to Alpha?", "Beta")]
    suite_dict = build_hotpot_suite(records, _config(), tmp_path / "assets")
    suite = load_suite_from_dict(suite_dict, tmp_path)

    assert suite.suite == "hotpot_test"
    assert suite.owner_user_id == "__eval_hotpot_test__"
    # context 3 段落すべてがコーパスへ
    assert len(suite.documents) == 3
    assert len(suite.cases) == 1
    case = suite.cases[0]
    assert case.id == "hotpot-dev-q1"
    assert case.top_k == 10
    # supporting_facts の Alpha/Beta が relevant、Distractor は含まない
    assert len(case.relevant_documents) == 2
    assert all(d in suite.documents for d in case.relevant_documents)
    # answer が key_fact に
    assert case.key_facts[0].any == ["Beta"]
    # 資産ファイルが書かれ、本文にタイトルと文が入る
    gold_file = tmp_path / "assets" / case.relevant_documents[0]
    assert gold_file.exists()


def test_shared_corpus_dedupes_titles(tmp_path):
    # 同じタイトルが複数設問に跨っても 1 文書に畳まれる
    records = [_record("q1", "Q1?", "Beta"), _record("q2", "Q2?", "Beta")]
    suite_dict = build_hotpot_suite(records, _config(), tmp_path / "assets")
    assert len(suite_dict["documents"]) == 3  # Alpha/Beta/Distractor のみ
    assert len(suite_dict["cases"]) == 2


def test_yes_no_answer_has_no_key_facts(tmp_path):
    records = [_record("q1", "Same nationality?", "yes", type_="comparison")]
    suite_dict = build_hotpot_suite(records, _config(), tmp_path / "assets")
    assert suite_dict["cases"][0]["key_facts"] == []


def test_query_limit_caps_cases(tmp_path):
    records = [_record(f"q{i}", f"Q{i}?", "Beta") for i in range(5)]
    suite_dict = build_hotpot_suite(records, _config(query_limit=2), tmp_path / "assets")
    assert len(suite_dict["cases"]) == 2


def test_prepare_hotpot_suite_from_file_uri(tmp_path):
    src = tmp_path / "hotpot.json"
    src.write_text(json.dumps([_record("q1", "Q?", "Beta")]), encoding="utf-8")
    golden = prepare_hotpot_suite(
        _config(source_url=src.as_uri()),
        tmp_path / "assets",
        tmp_path / "golden.yaml",
        tmp_path / "cache",
    )
    suite = load_suite(golden)
    assert suite.cases[0].key_facts[0].any == ["Beta"]


def test_prepare_hotpot_suite_from_gzip_source_path(tmp_path):
    src = tmp_path / "hotpot.json.gz"
    with gzip.open(src, "wt", encoding="utf-8") as f:
        json.dump([_record("q1", "Q?", "Beta")], f)
    golden = prepare_hotpot_suite(
        _config(source_url=None, source_path=str(src)),
        tmp_path / "assets",
        tmp_path / "golden.yaml",
        tmp_path / "cache",
    )
    suite = load_suite(golden)
    assert suite.cases[0].key_facts[0].any == ["Beta"]


def test_vendored_suite_loads_and_builds(tmp_path):
    # 同梱データ(先頭200問)が元スキーマとして妥当で、fact_coverage 用の key_facts を生むことを検証。
    config = load_hotpot_config(_SUITE_YAML)
    assert config.source_path and config.source_path.endswith(".json.gz")
    suite_dict = build_hotpot_suite(_read_vendored(config), config, tmp_path / "assets")
    suite = load_suite_from_dict(suite_dict, tmp_path)
    assert len(suite.cases) == config.query_limit  # query_limit=100 で頭打ち
    # yes/no 以外の設問では answer が key_fact になり facts 列が埋まる
    assert any(c.key_facts for c in suite.cases)
    # 正解文書は必ずコーパスに含まれる
    for c in suite.cases:
        assert all(d in suite.documents for d in c.relevant_documents)


def _read_vendored(config):
    with gzip.open(config.source_path, "rt", encoding="utf-8") as f:
        return json.load(f)


def load_suite_from_dict(suite_dict, tmp_path):
    import yaml
    golden = tmp_path / "golden.yaml"
    golden.write_text(yaml.safe_dump(suite_dict, allow_unicode=True, sort_keys=False),
                      encoding="utf-8")
    return load_suite(golden)
