from eval.metrics import (
    fact_coverage,
    mrr,
    ndcg_at_k,
    normalize_text,
    precision_at_k,
    recall_at_k,
)


def test_recall_at_k_counts_relevant_hits():
    ranked = ["a.pdf", "b.pdf", "c.pdf"]
    assert recall_at_k(ranked, {"a.pdf", "c.pdf"}, k=3) == 1.0
    assert recall_at_k(ranked, {"a.pdf", "c.pdf"}, k=2) == 0.5
    assert recall_at_k(ranked, {"z.pdf"}, k=3) == 0.0
    assert recall_at_k([], {"a.pdf"}, k=5) == 0.0


def test_precision_at_k():
    ranked = ["a.pdf", "x.pdf", "b.pdf"]
    assert precision_at_k(ranked, {"a.pdf", "b.pdf"}, k=2) == 0.5


def test_mrr_uses_first_relevant_rank():
    assert mrr(["x.pdf", "a.pdf"], {"a.pdf"}) == 0.5
    assert mrr(["a.pdf"], {"a.pdf"}) == 1.0
    assert mrr(["x.pdf"], {"a.pdf"}) == 0.0


def test_ndcg_at_k_perfect_and_partial():
    assert ndcg_at_k(["a.pdf", "b.pdf"], {"a.pdf", "b.pdf"}, k=2) == 1.0
    # 1件正解が2位のみ: DCG=1/log2(3), IDCG=1/log2(2)=1
    import math
    expected = (1 / math.log2(3)) / 1.0
    assert abs(ndcg_at_k(["x.pdf", "a.pdf"], {"a.pdf"}, k=2) - expected) < 1e-9


def test_normalize_text_folds_width_and_space_and_case():
    assert normalize_text("ＡＢ　９２万円  X") == "ab 92万円 x"


def test_fact_coverage_substring_after_normalize():
    corpus = normalize_text("採用候補は AlphaGate X2。初年度費用 92万円。")
    facts = [["alphagate x2"], ["920000", "92万円"], ["存在しない"]]
    assert fact_coverage(corpus, facts) == 2 / 3
    assert fact_coverage(corpus, []) == 1.0
