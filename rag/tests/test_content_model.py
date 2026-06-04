import uuid

from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob


def _mk_content(session, content_hash):
    c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                raw_path=f"/tmp/{content_hash}.pdf", status="queued", ref_count=0)
    session.add(c)
    session.flush()
    return c


def test_content_holds_chunks_and_jobs_by_hash():
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    try:
        _mk_content(session, h)
        session.add(Chunk(content_hash=h, ordinal=0, heading_path="", page_start=0,
                          page_end=0, block_type="text", token_len=3, text="本文"))
        session.add(IngestJob(content_hash=h, status="queued"))
        session.commit()
        assert session.query(Chunk).filter_by(content_hash=h).count() == 1
        assert session.query(IngestJob).filter_by(content_hash=h).count() == 1
    finally:
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_same_owner_same_content_unique():
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    owner = "u_" + uuid.uuid4().hex
    try:
        _mk_content(session, h)
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a.pdf"))
        session.commit()
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a-again.pdf"))
        raised = False
        try:
            session.commit()
        except IntegrityError:
            raised = True
            session.rollback()
        assert raised, "同一 owner・同一 content の二重参照は UNIQUE 違反になること"
    finally:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
