import uuid
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob, WorkspaceActivity
from app.parsing.types import ParsedBlock, ParsedDocument
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore
from app.worker import ingest_document, requeue_interrupted_jobs, run_ingest

COLL = "test_ingest_" + uuid.uuid4().hex[:8]


def fake_parse(path, out_dir):
    return ParsedDocument(
        blocks=[ParsedBlock(type="title", text="章", level=1),
                ParsedBlock(type="text", text="本文です。", page=0)],
        page_count=1,
    )


class RecordingEmbedder(StubEmbedder):
    def __init__(self, dim: int = 8):
        super().__init__(dim=dim)
        self.seen: list[str] = []

    def embed(self, texts):
        self.seen = list(texts)
        return super().embed(texts)


def _mk(session, owner, content_hash, raw_path):
    content = Content(content_hash=content_hash, mime="application/pdf", size=10,
                      raw_path=raw_path, status="queued", ref_count=1)
    session.add(content)
    session.flush()
    doc = Document(owner_user_id=owner, content_hash=content_hash, filename="x.pdf")
    job = IngestJob(content_hash=content_hash, status="queued")
    session.add(doc)
    session.add(job)
    session.commit()
    return content, doc, job


def _cleanup(session, store, content_hash, owner=None):
    store.drop()
    session.query(Chunk).filter_by(content_hash=content_hash).delete()
    session.query(IngestJob).filter_by(content_hash=content_hash).delete()
    session.query(Document).filter_by(content_hash=content_hash).delete()
    session.query(Content).filter_by(content_hash=content_hash).delete()
    if owner:
        session.query(WorkspaceActivity).filter_by(owner_user_id=owner).delete()
    session.commit()
    session.close()


def test_run_ingest_persists_chunks_and_marks_ready():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, doc, job = _mk(session, owner, h, "/tmp/x.pdf")

    store = QdrantStore(collection=COLL, dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, h, job.id)

    session.refresh(content)
    session.refresh(job)
    assert content.status == "ready"
    assert job.status == "ready" and job.progress == 100
    n_chunks = session.query(Chunk).filter_by(content_hash=h).count()
    assert n_chunks >= 1
    assert store.count() == n_chunks
    activity = session.get(WorkspaceActivity, owner)
    assert activity is not None and activity.last_document_activity_at is not None

    _cleanup(session, store, h, owner)


def test_run_ingest_marks_all_owners_activity():
    """共有 content の ready 化は、参照する全 owner の活動を記録する。"""
    session = SessionLocal()
    o1, o2 = "u_" + uuid.uuid4().hex, "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, o1, h, "/tmp/x.pdf")
    session.add(Document(owner_user_id=o2, content_hash=h, filename="x2.pdf"))
    content.ref_count = 2
    session.commit()

    store = QdrantStore(collection="test_two_" + uuid.uuid4().hex[:8], dim=8)
    run_ingest(session, store, StubEmbedder(dim=8), fake_parse, h, job.id)

    assert session.get(WorkspaceActivity, o1) is not None
    assert session.get(WorkspaceActivity, o2) is not None

    store.drop()
    session.query(Chunk).filter_by(content_hash=h).delete()
    session.query(IngestJob).filter_by(content_hash=h).delete()
    session.query(Document).filter_by(content_hash=h).delete()
    session.query(Content).filter_by(content_hash=h).delete()
    session.query(WorkspaceActivity).filter(WorkspaceActivity.owner_user_id.in_([o1, o2])).delete()
    session.commit()
    session.close()


def test_run_ingest_copies_assets_and_excludes_image_chunks(tmp_path, monkeypatch):
    mineru_dir = tmp_path / "mineru"
    (mineru_dir / "images").mkdir(parents=True)
    (mineru_dir / "images" / "a.png").write_bytes(b"\x89PNG\r\n")
    raw = tmp_path / "doc.pdf"
    raw.write_bytes(b"%PDF-1.7")

    def parse_with_image(path, out_dir):
        return ParsedDocument(
            blocks=[ParsedBlock(type="title", text="章", level=1),
                    ParsedBlock(type="text", text="本文です。", page=0),
                    ParsedBlock(type="image", image_path="images/a.png",
                                caption="図", page=0)],
            page_count=1, images_dir=str(mineru_dir),
        )

    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, owner, h, str(raw))

    emb = RecordingEmbedder(dim=8)
    coll = "test_ingest_img_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    run_ingest(session, store, emb, parse_with_image, h, job.id)

    chunks = session.query(Chunk).filter_by(content_hash=h).all()
    types = {c.block_type for c in chunks}
    assert "image" in types
    n_index = sum(1 for c in chunks if c.block_type != "image")
    assert store.count() == n_index
    assert all("![" not in t for t in emb.seen)
    copied = Path(str(raw.with_suffix("")) + "_assets") / "images" / "a.png"
    assert copied.is_file()

    _cleanup(session, store, h, owner)



async def test_ingest_document_marks_error_when_model_setup_fails(monkeypatch):
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    content, _, job = _mk(session, owner, h, "/tmp/x.pdf")
    job_id = job.id
    session.close()

    def boom():
        raise RuntimeError("model download failed")

    monkeypatch.setattr("app.worker.get_embedder", boom)

    with pytest.raises(RuntimeError):
        await ingest_document({}, h, job_id)

    check = SessionLocal()
    try:
        j = check.get(IngestJob, job_id)
        c = check.get(Content, h)
        assert j.status == "error"
        assert "model download failed" in (j.error or "")
        assert c.status == "error"
        assert "model download failed" in (c.error or "")
    finally:
        check.query(IngestJob).filter_by(content_hash=h).delete()
        check.query(Document).filter_by(content_hash=h).delete()
        check.query(Content).filter_by(content_hash=h).delete()
        check.commit()
        check.close()


async def test_requeue_interrupted_jobs_reenqueues_queued_jobs():
    session = SessionLocal()
    owner = "u_" + uuid.uuid4().hex
    h = "h_" + uuid.uuid4().hex
    _content, _doc, job = _mk(session, owner, h, "/tmp/x.pdf")
    job_id = job.id
    session.close()

    class FakeRedis:
        def __init__(self):
            self.enqueued = []

        async def enqueue_job(self, name, content_hash, queued_job_id, **kwargs):
            self.enqueued.append((name, content_hash, queued_job_id, kwargs))

    redis = FakeRedis()
    try:
        await requeue_interrupted_jobs({"redis": redis})

        assert ("ingest_document", h, job_id, {"_job_id": job_id}) in redis.enqueued
    finally:
        cleanup = SessionLocal()
        try:
            cleanup.query(IngestJob).filter_by(content_hash=h).delete()
            cleanup.query(Document).filter_by(content_hash=h).delete()
            cleanup.query(Content).filter_by(content_hash=h).delete()
            cleanup.commit()
        finally:
            cleanup.close()
