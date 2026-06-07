from app.schemas import RetrievedChunk
from app.retrieval.multihop import _rrf_fuse, _prf_query
from app.retrieval import multihop as mh


def _mk(cid: str, title: str = "") -> RetrievedChunk:
    return RetrievedChunk(chunk_id=cid, document_id=f"doc-{cid}", document_title=title or cid,
                          heading_path="h", page_start=0, page_end=0, block_type="text",
                          text=cid, expanded_text=cid, score=0.5)


def test_rrf_fuse_hop2_empty_returns_hop1_topk():
    out = _rrf_fuse([_mk("a"), _mk("b"), _mk("c")], [], top_k=2)
    assert [c.chunk_id for c in out] == ["a", "b"]


def test_rrf_fuse_merges_and_dedups():
    out = _rrf_fuse([_mk("a"), _mk("b")], [_mk("b"), _mk("c")], top_k=4)
    assert sorted(c.chunk_id for c in out) == ["a", "b", "c"]


def test_rrf_fuse_bridge_quota_keeps_hop2_top():
    out = _rrf_fuse([_mk("a"), _mk("b")], [_mk("x")], top_k=2, bridge_quota=1)
    ids = [c.chunk_id for c in out]
    assert "x" in ids
    assert len(out) == 2


def test_rrf_fuse_weight_keeps_hop1_leader_at_head():
    # hop1 を重く融合すると、hop1 の順位がそのまま頭に保たれ、hop2 専用 doc は後段に回る。
    # （対称重みだと PRF で drift した hop2 が頭を並べ替えてしまうのを防ぐ狙い）
    out = _rrf_fuse([_mk("a"), _mk("b")], [_mk("x")], top_k=3, bridge_quota=0,
                    hop1_weight=3.0, hop2_weight=1.0)
    assert [c.chunk_id for c in out] == ["a", "b", "x"]


def test_rrf_fuse_quota1_evicts_only_lowest_hop1():
    # bridge_quota=1 は hop1 の最下位 1 件だけを hop2 専用 doc で置換する。
    out = _rrf_fuse([_mk("a"), _mk("b"), _mk("c")], [_mk("x"), _mk("y")],
                    top_k=3, bridge_quota=1, hop1_weight=3.0, hop2_weight=1.0)
    assert [c.chunk_id for c in out] == ["a", "b", "x"]


def test_rrf_fuse_quota2_evicts_more_hop1_regression_mechanism():
    # quota=2 は hop1 を 2 件も追い出す（hop1 が既に持つ gold を落とす自爆の再現）。
    # quota=1（上のテスト）と比べ b まで消えることを固定し、quota を絞った理由を明示する。
    out = _rrf_fuse([_mk("a"), _mk("b"), _mk("c")], [_mk("x"), _mk("y")],
                    top_k=3, bridge_quota=2, hop1_weight=3.0, hop2_weight=1.0)
    assert [c.chunk_id for c in out] == ["a", "x", "y"]


def test_prf_query_appends_top_doc_text():
    hop1 = [_mk("a", "Brown State Fishing Lake")]
    hop1[0].text = "located in Brown County, Kansas"
    hop1[0].expanded_text = "located in Brown County, Kansas"
    q = _prf_query("人口は?", hop1)
    assert q.startswith("人口は?")
    assert "Brown County" in q
    assert "Brown State Fishing Lake" in q


def test_prf_query_empty_hop1_returns_original():
    assert _prf_query("q", []) == "q"


def test_prf_query_truncates_body():
    c = _mk("a", "T")
    c.text = c.expanded_text = "x" * 1000
    q = _prf_query("q", [c], n_docs=1, char_budget=50)
    assert q.count("x") == 50


def _make_fake_retrieve(calls):
    lake = _mk("lake-1", "Brown State Fishing Lake")
    lake.text = lake.expanded_text = "located in Brown County, Kansas (no population here)"
    county = _mk("county-1", "Brown County, Kansas")
    county.text = county.expanded_text = "population was 9,508"

    def fake_retrieve(session, store, embedder, reranker, *, query, owner_user_id,
                      top_k=6, candidate_k=50, document_ids=None):
        calls.append(query)
        return [county] if "Brown County" in query else [lake]
    return fake_retrieve


def test_retrieve_multihop_recovers_answer_via_hop2(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(mh, "retrieve", _make_fake_retrieve(calls))
    out = mh.retrieve_multihop(None, None, None, None,
                               query="Brown State Fishing Lake のある郡の人口は?",
                               owner_user_id="u1", top_k=6)
    titles = [c.document_title for c in out]
    assert "Brown County, Kansas" in titles
    assert len(calls) == 2  # hop-1 + hop-2


def test_retrieve_multihop_max_hops_zero_skips_hop2(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(mh, "retrieve", _make_fake_retrieve(calls))
    out = mh.retrieve_multihop(None, None, None, None, query="q",
                               owner_user_id="u1", top_k=6, max_hops=0)
    assert len(calls) == 1
    assert [c.chunk_id for c in out] == ["lake-1"]


def test_retrieve_multihop_empty_hop1_returns_empty(monkeypatch):
    def fake_retrieve(*a, **k):
        return []
    monkeypatch.setattr(mh, "retrieve", fake_retrieve)
    out = mh.retrieve_multihop(None, None, None, None, query="q",
                               owner_user_id="u1", top_k=6)
    assert out == []


def test_retrieve_multihop_stream_relays_and_fuses(monkeypatch):
    lake = _mk("lake-1", "Brown State Fishing Lake")
    lake.text = lake.expanded_text = "located in Brown County, Kansas"
    county = _mk("county-1", "Brown County, Kansas")
    county.text = county.expanded_text = "population was 9,508"

    def fake_stream(session, store, embedder, reranker, *, query, owner_user_id,
                    top_k=6, candidate_k=50, document_ids=None):
        yield {"stage": "embed", "status": "done", "ms": 1}
        if "Brown County" in query:
            yield {"stage": "result", "chunks": [county]}
        else:
            yield {"stage": "result", "chunks": [lake]}

    monkeypatch.setattr(mh, "retrieve_stream", fake_stream)
    evs = list(mh.retrieve_multihop_stream(None, None, None, None,
               query="Brown State Fishing Lake のある郡の人口は?",
               owner_user_id="u1", top_k=6))
    # hop-1 の embed（hop 印なし）, hop-2 の embed（hop=2）, 最終 result
    assert any(e.get("stage") == "embed" and "hop" not in e for e in evs)
    assert any(e.get("stage") == "embed" and e.get("hop") == 2 for e in evs)
    # hop-2 のステージには実際に検索した PRF 展開クエリが載る（hop-1 とは別物）
    hop2 = [e for e in evs if e.get("hop") == 2]
    assert hop2
    assert all("Brown County" in e.get("query", "") for e in hop2)
    assert all(e["query"] != "Brown State Fishing Lake のある郡の人口は?" for e in hop2)
    # hop-1 のステージには query を載せない（元クエリ＝エージェントクエリが UI 側で出る）
    assert all("query" not in e for e in evs if e.get("stage") != "result" and e.get("hop") != 2)
    result = [e for e in evs if e.get("stage") == "result"]
    assert len(result) == 1
    titles = [c.document_title for c in result[0]["chunks"]]
    assert "Brown County, Kansas" in titles
