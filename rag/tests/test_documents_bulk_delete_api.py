import uuid

from app.config import settings
from app.db import SessionLocal
from app.models import Content, Document


def _seed(owner, filename="f.pdf"):
    session = SessionLocal()
    h = "h_" + uuid.uuid4().hex
    session.add(Content(content_hash=h, mime="application/pdf", size=10,
                        raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=h, filename=filename)
    session.add(doc)
    session.commit()
    doc_id = doc.id
    session.close()
    return doc_id


def _hdr():
    return {"x-internal-token": settings.rag_internal_token}


def _content_hashes(doc_ids):
    session = SessionLocal()
    try:
        return [d.content_hash for d in
                session.query(Document).filter(Document.id.in_(doc_ids)).all()]
    finally:
        session.close()


def test_bulk_delete_requires_token(client):
    res = client.post("/documents/bulk-delete",
                      json={"owner_user_id": "u1", "document_ids": ["d1"]})
    assert res.status_code == 401


def test_bulk_delete_removes_owned_and_reports_missing(client):
    owner = "u_" + uuid.uuid4().hex
    other = "u_" + uuid.uuid4().hex
    d1 = _seed(owner)
    d2 = _seed(owner)
    d4 = _seed(other)
    h1, h2 = _content_hashes([d1, d2])
    missing = str(uuid.uuid4())  # 不在 id（Document.id は UUID 型）
    res = client.post("/documents/bulk-delete",
                      headers=_hdr(),
                      json={"owner_user_id": owner,
                            "document_ids": [d1, d2, missing, d4]})
    assert res.status_code == 200
    body = res.json()
    assert body["deleted"] == [d1, d2]
    assert body["not_found"] == [missing, d4]
    session = SessionLocal()
    try:
        # 各 doc は ref_count=1 だったので、削除で content も GC される。
        assert session.get(Content, h1) is None
        assert session.get(Content, h2) is None
        # 別人所有の d4 は削除されない。
        assert session.get(Document, d4) is not None
    finally:
        # 後始末（d4 とその content）。
        leftover = session.get(Document, d4)
        if leftover is not None:
            h4 = leftover.content_hash
            session.query(Document).filter_by(content_hash=h4).delete()
            session.query(Content).filter_by(content_hash=h4).delete()
            session.commit()
        session.close()


def test_bulk_delete_empty_list_is_noop(client):
    owner = "u_" + uuid.uuid4().hex
    res = client.post("/documents/bulk-delete",
                      headers=_hdr(),
                      json={"owner_user_id": owner, "document_ids": []})
    assert res.status_code == 200
    assert res.json() == {"deleted": [], "not_found": []}
