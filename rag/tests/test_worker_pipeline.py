import uuid

from app.db import SessionLocal
from app.models import Chunk, Document, IngestJob
from app.parsing.types import ParsedBlock, ParsedDocument
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore
from app.worker import run_ingest

COLL = "test_ingest_" + uuid.uuid4().hex[:8]


def fake_parse(path, out_dir):
    return ParsedDocument(
        blocks=[ParsedBlock(type="title", text="章", level=1),
                ParsedBlock(type="text", text="本文です。", page=0)],
        page_count=1,
    )


def test_run_ingest_persists_chunks_and_marks_ready():
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="x.pdf", mime="application/pdf",
                   size=10, raw_path="/tmp/x.pdf", status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id="u1", status="queued")
    session.add(job)
    session.commit()

    store = QdrantStore(collection=COLL, dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, doc.id, job.id)

    session.refresh(doc)
    session.refresh(job)
    assert doc.status == "ready"
    assert job.status == "ready" and job.progress == 100
    n_chunks = session.query(Chunk).filter_by(document_id=doc.id).count()
    assert n_chunks >= 1
    assert store.count() == n_chunks

    store.drop()
    session.query(Chunk).filter_by(document_id=doc.id).delete()
    session.query(IngestJob).filter_by(id=job.id).delete()
    session.query(Document).filter_by(id=doc.id).delete()
    session.commit()
    session.close()
