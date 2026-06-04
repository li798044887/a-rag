import uuid

from app.db import SessionLocal
from app.documents_service import workspace_stats
from app.models import Content, Document


def test_stats_counts_indexed_by_content_status():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h_ready, h_queued = "h_" + uuid.uuid4().hex, "h_" + uuid.uuid4().hex
    try:
        for h, st in ((h_ready, "ready"), (h_queued, "queued")):
            session.add(Content(content_hash=h, mime="application/pdf", size=10,
                                raw_path=f"/tmp/{h}.pdf", status=st, ref_count=1))
            session.flush()
            session.add(Document(owner_user_id=owner, content_hash=h, filename="f.pdf"))
        session.commit()

        stats = workspace_stats(session, owner_user_id=owner)
        assert stats.total_document_count == 2
        assert stats.indexed_document_count == 1
        assert stats.connected_data_source_count == 1
    finally:
        for h in (h_ready, h_queued):
            session.query(Document).filter_by(content_hash=h).delete()
            session.query(Content).filter_by(content_hash=h).delete()
        session.commit()
        session.close()
