from app.schemas import RetrievedChunk
from app.retrieval.multihop import _rrf_fuse, _prf_query


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
