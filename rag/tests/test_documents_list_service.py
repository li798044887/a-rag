import uuid

from app.db import SessionLocal
from app.documents_service import list_documents
from app.models import Chunk, Content, Document, IngestJob


def _seed(session, owner, n):
    hashes = []
    for i in range(n):
        h = f"h_{uuid.uuid4().hex}"
        session.add(Content(content_hash=h, mime="application/pdf", size=10,
                            raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
        session.flush()
        session.add(Document(owner_user_id=owner, content_hash=h, filename=f"f{i}.pdf"))
        session.add(Chunk(content_hash=h, ordinal=0, heading_path="", page_start=0,
                          page_end=0, block_type="text", token_len=1, text="t"))
        session.add(IngestJob(content_hash=h, status="ready"))
        hashes.append(h)
    session.commit()
    return hashes


def _cleanup(session, hashes, owner):
    session.query(Chunk).filter(Chunk.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(IngestJob).filter(IngestJob.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(Document).filter(Document.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.query(Content).filter(Content.content_hash.in_(hashes)).delete(synchronize_session=False)
    session.commit()
    session.close()


def test_list_returns_content_fields_and_counts():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    hashes = _seed(session, owner, 2)
    try:
        res = list_documents(session, owner_user_id=owner, limit=30)
        assert res.total == 2
        assert len(res.items) == 2
        for it in res.items:
            assert it.mime == "application/pdf"
            assert it.status == "ready"
            assert it.chunk_count == 1
            assert it.latest_job_id is not None
    finally:
        _cleanup(session, hashes, owner)


def test_list_pagination_cursor():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    hashes = _seed(session, owner, 3)
    try:
        first = list_documents(session, owner_user_id=owner, limit=2)
        assert len(first.items) == 2 and first.next_cursor
        second = list_documents(session, owner_user_id=owner, limit=2, cursor=first.next_cursor)
        assert len(second.items) == 1 and second.next_cursor is None
    finally:
        _cleanup(session, hashes, owner)
