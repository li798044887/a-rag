import uuid

from app.config import settings
from app.db import SessionLocal
from app.models import Content, Document, IngestJob


def _seed_queued(owner, content_hash):
    session = SessionLocal()
    c = session.get(Content, content_hash)
    if c is None:
        c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                    raw_path=f"/tmp/{content_hash}.pdf", status="queued", ref_count=0)
        session.add(c)
        session.flush()
        session.add(IngestJob(content_hash=content_hash, status="queued"))
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename="f.pdf")
    session.add(doc)
    c.ref_count = c.ref_count + 1
    session.commit()
    job = session.query(IngestJob).filter_by(content_hash=content_hash).first()
    ids = (doc.id, job.id)
    session.close()
    return ids


def _hdr():
    return {"x-internal-token": settings.rag_internal_token}


def test_cancel_last_reference_removes_job_and_content(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _doc_id, job_id = _seed_queued(owner, h)
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        assert session.get(Content, h) is None
        assert session.get(IngestJob, job_id) is None
    finally:
        session.close()


def test_cancel_one_of_two_keeps_queued_content(client):
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _seed_queued(o1, h)
    _doc2, job_id = _seed_queued(o2, h)
    # o1 がキャンセル → ref は減るが content は queued のまま残る
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={o1}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 1
        assert session.get(IngestJob, job_id) is not None
    finally:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_cancel_409_when_not_queued(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _doc_id, job_id = _seed_queued(owner, h)
    session = SessionLocal()
    c = session.get(Content, h)
    c.status = "parsing"
    session.commit()
    session.close()
    res = client.post(f"/jobs/{job_id}/cancel?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 409
    session = SessionLocal()
    try:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
    finally:
        session.close()
