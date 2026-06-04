import uuid

from app.config import settings
from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob


def _seed(owner, content_hash, ref_count, filename="f.pdf"):
    session = SessionLocal()
    c = session.get(Content, content_hash)
    if c is None:
        c = Content(content_hash=content_hash, mime="application/pdf", size=10,
                    raw_path=f"/tmp/{content_hash}.pdf", status="ready", ref_count=ref_count)
        session.add(c)
        session.flush()
        session.add(Chunk(content_hash=content_hash, ordinal=0, heading_path="",
                          page_start=0, page_end=0, block_type="text", token_len=1, text="t"))
        session.add(IngestJob(content_hash=content_hash, status="ready"))
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename=filename)
    session.add(doc)
    session.commit()
    doc_id = doc.id
    session.close()
    return doc_id


def _hdr():
    return {"x-internal-token": settings.rag_internal_token}


def test_delete_last_reference_gcs_content(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    doc_id = _seed(owner, h, ref_count=1)
    res = client.request("DELETE", f"/documents/{doc_id}?owner_user_id={owner}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        assert session.get(Content, h) is None  # 最後の参照削除で実体も消える
        assert session.query(Chunk).filter_by(content_hash=h).count() == 0
    finally:
        session.close()


def test_delete_one_of_two_keeps_content(client):
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    d1 = _seed(o1, h, ref_count=2)
    _seed(o2, h, ref_count=2)  # content は既存なので doc だけ追加
    res = client.request("DELETE", f"/documents/{d1}?owner_user_id={o1}", headers=_hdr())
    assert res.status_code == 204
    session = SessionLocal()
    try:
        c = session.get(Content, h)
        assert c is not None and c.ref_count == 1  # 他ユーザーが参照中なので残る
        assert session.query(Chunk).filter_by(content_hash=h).count() == 1
    finally:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()


def test_delete_404_when_not_owner(client):
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    doc_id = _seed(owner, h, ref_count=1)
    res = client.request("DELETE", f"/documents/{doc_id}?owner_user_id=intruder", headers=_hdr())
    assert res.status_code == 404
    session = SessionLocal()
    try:
        session.query(Document).filter_by(content_hash=h).delete()
        session.query(Chunk).filter_by(content_hash=h).delete()
        session.query(IngestJob).filter_by(content_hash=h).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
    finally:
        session.close()
