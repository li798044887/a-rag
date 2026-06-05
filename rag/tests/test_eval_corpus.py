import uuid

import pytest

from app.db import SessionLocal
from app.models import Content, Document
from eval.corpus import MissingDocumentsError, resolve


def test_resolve_maps_filenames_and_reports_missing():
    session = SessionLocal()
    owner = "evalcorpus_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    try:
        session.add(Content(content_hash=h, mime="application/pdf", size=1,
                            raw_path=f"/tmp/{h}.pdf", status="ready", ref_count=1))
        session.flush()
        session.add(Document(owner_user_id=owner, content_hash=h, filename="a.pdf"))
        session.commit()

        mapping = resolve(session, owner, ["a.pdf"])
        assert mapping["a.pdf"][1] == h

        with pytest.raises(MissingDocumentsError, match="b.pdf"):
            resolve(session, owner, ["a.pdf", "b.pdf"])
    finally:
        session.query(Document).filter_by(owner_user_id=owner).delete()
        session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
