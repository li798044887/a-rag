import uuid

from app.config import settings
from app.documents_service import select_chunks
from app.routers import documents as documents_router
from app.schemas import FetchDocumentResponse, FetchedChunk


def _seed_doc_with_chunks(owner, n=3, filename="d.pdf"):
    import uuid
    from app.db import SessionLocal
    from app.models import Chunk, Content, Document
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    session.add(Content(content_hash=h, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=h, filename=filename)
    session.add(doc)
    chunk_ids = []
    for i in range(n):
        ch = Chunk(content_hash=h, ordinal=i, heading_path=f"h{i}",
                   page_start=i, page_end=i, block_type="text", token_len=1,
                   text=f"chunk{i}")
        session.add(ch)
        session.flush()
        chunk_ids.append(ch.id)
    session.commit()
    ids = (doc.id, h, chunk_ids)
    session.close()
    return ids


def _cleanup_seed(h):
    from app.db import SessionLocal
    from app.models import Chunk, Content, Document
    session = SessionLocal()
    session.query(Chunk).filter_by(content_hash=h).delete()
    session.query(Document).filter_by(content_hash=h).delete()
    session.query(Content).filter_by(content_hash=h).delete()
    session.commit()
    session.close()


class _C:
    def __init__(self, ordinal):
        self.ordinal = ordinal
        self.id = f"c{ordinal}"


def test_select_chunks_truncates_to_max():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=None, window=2, max_chunks=40)
    assert len(out) == 40
    assert out[0].ordinal == 0


def test_select_chunks_windows_around_ordinal():
    chunks = [_C(i) for i in range(100)]
    out = select_chunks(chunks, around_ordinal=50, window=2, max_chunks=40)
    assert [c.ordinal for c in out] == [48, 49, 50, 51, 52]


def test_fetch_document_requires_token(client):
    res = client.post("/documents/d1/chunks", json={"owner_user_id": "u1"})
    assert res.status_code == 401


def test_fetch_document_returns_chunks(client, monkeypatch):
    def fake(document_id, req):
        return FetchDocumentResponse(
            document_id=document_id, document_title="設計.pdf",
            chunks=[FetchedChunk(chunk_id="c1", ordinal=0, heading_path="認証",
                                 page_start=0, page_end=0, block_type="text", text="本文")])
    monkeypatch.setattr(documents_router, "_fetch_document", fake)
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "u1"})
    assert res.status_code == 200
    body = res.json()
    assert body["document_title"] == "設計.pdf"
    assert body["chunks"][0]["chunk_id"] == "c1"


def test_fetch_document_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
    class _Session:
        def get(self, model, _id):
            return _Doc()
        def query(self, *a, **k):
            raise AssertionError("should not query when ownership fails")
        def close(self):
            pass
    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.post("/documents/d1/chunks",
                      headers={"x-internal-token": settings.rag_internal_token},
                      json={"owner_user_id": "intruder-B"})
    assert res.status_code == 404


def test_fetch_chunks_real_db_by_content_hash(client):
    """content_hash 基準のチャンク取得が共有チャンクを返すことを実 DB で検証する。"""
    owner = "u_" + uuid.uuid4().hex
    doc_id, h, _chunk_ids = _seed_doc_with_chunks(owner)
    try:
        res = client.post(f"/documents/{doc_id}/chunks",
                          headers={"x-internal-token": settings.rag_internal_token},
                          json={"owner_user_id": owner})
        assert res.status_code == 200
        body = res.json()
        assert body["document_id"] == doc_id
        assert body["document_title"] == "d.pdf"
        texts = {c["text"] for c in body["chunks"]}
        assert {"chunk0", "chunk1", "chunk2"} <= texts
    finally:
        _cleanup_seed(h)


def test_fetch_chunks_404_for_non_owner(client):
    """非参照ユーザーは共有チャンクを読めない（所有権チェックで 404）。"""
    owner = "u_" + uuid.uuid4().hex
    doc_id, h, _chunk_ids = _seed_doc_with_chunks(owner)
    try:
        res = client.post(f"/documents/{doc_id}/chunks",
                          headers={"x-internal-token": settings.rag_internal_token},
                          json={"owner_user_id": "intruder-" + uuid.uuid4().hex})
        assert res.status_code == 404
    finally:
        _cleanup_seed(h)
