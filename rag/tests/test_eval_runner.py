from dataclasses import dataclass

from eval.dataset import GoldenSuite
from eval.runner import run_suite


@dataclass
class FakeChunk:
    document_title: str
    text: str = ""
    expanded_text: str = ""


def _suite() -> GoldenSuite:
    return GoldenSuite.model_validate({
        "suite": "t",
        "owner_user_id": "__eval__",
        "documents": ["a.pdf", "b.pdf"],
        "cases": [{
            "id": "c1",
            "query": "q",
            "top_k": 5,
            "relevant_documents": ["a.pdf"],
            "key_facts": [{"any": ["AlphaGate X2"]}],
        }],
    })


def test_run_suite_computes_case_and_aggregate():
    def fake_retrieve(query, owner, top_k):
        assert owner == "__eval__"
        assert top_k == 5
        return [FakeChunk("a.pdf", expanded_text="採用候補は AlphaGate X2。"),
                FakeChunk("b.pdf")]

    result = run_suite(_suite(), fake_retrieve)
    case = result["cases"][0]
    assert case["id"] == "c1"
    assert case["recall_at_5"] == 1.0
    assert case["fact_coverage"] == 1.0
    assert case["n_retrieved"] == 2
    assert result["aggregate"]["recall_at_5"] == 1.0
    assert result["aggregate"]["fact_coverage"] == 1.0


def test_run_suite_miss_lowers_metrics():
    def fake_retrieve(query, owner, top_k):
        return [FakeChunk("b.pdf", expanded_text="無関係")]

    result = run_suite(_suite(), fake_retrieve)
    case = result["cases"][0]
    assert case["recall_at_5"] == 0.0
    assert case["fact_coverage"] == 0.0
    assert case["mrr"] == 0.0
