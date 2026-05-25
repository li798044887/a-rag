from app.reranker.factory import StubReranker, get_reranker


def test_stub_reranker_scores_by_overlap():
    r = StubReranker()
    scores = r.score("認証 トークン", ["認証トークンの失効", "請求書の発行"])
    assert scores[0] > scores[1]


def test_factory_returns_stub(monkeypatch):
    monkeypatch.setenv("RERANKER", "stub")
    assert isinstance(get_reranker(), StubReranker)
