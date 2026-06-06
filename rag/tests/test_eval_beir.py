import json
import zipfile

from eval.beir import BeirConfig, prepare_beir_suite
from eval.dataset import Thresholds, load_suite


def _write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_prepare_beir_suite_generates_assets_and_golden(tmp_path):
    src = tmp_path / "src" / "scifact"
    qrels = src / "qrels"
    qrels.mkdir(parents=True)
    _write_jsonl(src / "corpus.jsonl", [
        {"_id": "doc/1", "title": "Alpha", "text": "alpha text"},
        {"_id": "doc/2", "title": "Beta", "text": "beta text"},
        {"_id": "doc/3", "title": "Gamma", "text": "gamma text"},
    ])
    _write_jsonl(src / "queries.jsonl", [
        {"_id": "q1", "text": "alpha?"},
        {"_id": "q2", "text": "beta?"},
    ])
    (qrels / "test.tsv").write_text(
        "query-id\tcorpus-id\tscore\nq1\tdoc/1\t1\nq2\tdoc/2\t1\n",
        encoding="utf-8")

    zip_path = tmp_path / "scifact.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(tmp_path))

    golden = prepare_beir_suite(
        BeirConfig(
            suite="beir_test",
            dataset="scifact",
            split="test",
            source_url=zip_path.as_uri(),
            owner_user_id="__eval_beir_test__",
            thresholds=Thresholds(recall_at_5=0.5),
            query_limit=1,
            corpus_limit=2,
        ),
        tmp_path / "assets",
        tmp_path / "golden.yaml",
        tmp_path / "cache",
    )

    suite = load_suite(golden)
    assert suite.suite == "beir_test"
    assert suite.owner_user_id == "__eval_beir_test__"
    assert len(suite.documents) == 2
    assert len(suite.cases) == 1
    assert suite.cases[0].relevant_documents == ["doc_1.txt"]
    assert (tmp_path / "assets" / "doc_1.txt").read_text(encoding="utf-8").startswith("# Alpha")
