import uuid
import logging

from app.db import SessionLocal
from app.models import Chunk, Document
from app.embedding.factory import StubEmbedder
from app.reranker.factory import StubReranker
from app.retrieval.service import retrieve, retrieve_stream
from app.vectorstore.qdrant import QdrantStore

COLL = "test_retr_" + uuid.uuid4().hex[:8]


def test_retrieve_reranks_and_expands_neighbors():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection=COLL, dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()

    bodies = ["前の文脈。", "認証トークンは24時間で失効する。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path="認証", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": "認証", "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    res = retrieve(session, store, e, r, query="認証トークン 失効",
                   owner_user_id="u1", top_k=1, candidate_k=10)
    assert len(res) == 1
    top = res[0]
    assert "失効する" in top.text
    assert top.document_title == "設計.pdf"
    # 近傍拡張: 前後の文脈が expanded_text に含まれる
    assert "前の文脈" in top.expanded_text and "次の文脈" in top.expanded_text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()


def test_retrieve_stream_empty_results_short_circuit():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_empty_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()

    events = list(retrieve_stream(session, store, e, r, query="認証トークン 失効",
                                  owner_user_id="nobody-" + uuid.uuid4().hex,
                                  top_k=1, candidate_k=10))
    stages = [ev["stage"] for ev in events]
    assert stages == ["embed", "embed", "vector_search", "bm25_search",
                      "vector_search", "bm25_search", "rerank", "rerank",
                      "expand", "expand", "result"]
    assert events[-1]["stage"] == "result"
    assert events[-1]["chunks"] == []

    store.drop()
    session.close()


def test_retrieve_stream_emits_stages_in_order():
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_strm_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()
    bodies = ["前の文脈。", "認証トークンは24時間で失効する。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path="認証", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": "認証", "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    events = list(retrieve_stream(session, store, e, r, query="認証トークン 失効",
                                  owner_user_id="u1", top_k=1, candidate_k=10))
    stages = [ev["stage"] for ev in events]
    assert stages == ["embed", "embed", "vector_search", "bm25_search",
                      "vector_search", "bm25_search", "rerank", "rerank",
                      "expand", "expand", "result"]
    result_ev = events[-1]
    assert result_ev["stage"] == "result"
    assert len(result_ev["chunks"]) == 1
    assert "失効する" in result_ev["chunks"][0].text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()


def test_retrieve_stream_done_events_carry_detail(caplog):
    caplog.set_level(logging.INFO, logger="app.retrieval.service")
    e, r = StubEmbedder(dim=8), StubReranker()
    store = QdrantStore(collection="test_detail_" + uuid.uuid4().hex[:8], dim=8)
    store.ensure_collection()
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="設計.pdf", mime="application/pdf",
                   size=1, raw_path="/tmp/x", status="ready")
    session.add(doc); session.flush()
    bodies = ["認証トークンは24時間で失効する。", "請求書の発行手順。", "次の文脈。"]
    rows = []
    for i, b in enumerate(bodies):
        c = Chunk(document_id=doc.id, ordinal=i, heading_path=f"H{i}", page_start=0,
                  page_end=0, block_type="text", token_len=len(b), text=b)
        session.add(c); session.flush(); rows.append(c)
    session.commit()
    store.upsert([
        {"chunk_id": c.id, "document_id": doc.id, "owner_user_id": "u1",
         "heading_path": c.heading_path, "page_start": 0, "page_end": 0, "block_type": "text",
         "source_type": "doc", "text": c.text, "vector": e.embed([c.text])[0]}
        for c in rows
    ])

    events = list(retrieve_stream(session, store, e, r, query="認証トークン 失効",
                                  owner_user_id="u1", top_k=2, candidate_k=10))
    by = {}
    for ev in events:
        if ev.get("status") == "done":
            by[ev["stage"]] = ev

    embed = by["embed"]
    assert embed["model"] == "stub" and embed["dims"] == 8

    vs = by["vector_search"]
    assert isinstance(vs["hits"], list) and vs["hits"]
    assert set(vs["hits"][0].keys()) == {"title", "heading", "score"}
    assert vs["hits"][0]["title"] == "設計.pdf"

    rr = by["rerank"]
    assert rr["model"] == "stub" and rr["top_n"] == 2
    assert isinstance(rr["selected"], list) and rr["selected"]
    assert set(rr["selected"][0].keys()) == {"id", "score", "title"}

    exp = by["expand"]
    assert exp["count"] == len(rr["selected"])
    assert "stage=rerank status=start candidate_count=" in caplog.text
    assert "stage=rerank status=done" in caplog.text

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit(); session.close()
