import uuid
from pathlib import Path

import pytest

from app.db import SessionLocal
from app.models import Chunk, Document, IngestJob, WorkspaceActivity
from app.parsing.types import ParsedBlock, ParsedDocument
from app.embedding.factory import StubEmbedder
from app.vectorstore.qdrant import QdrantStore
from app.worker import ingest_document, run_ingest

COLL = "test_ingest_" + uuid.uuid4().hex[:8]


def fake_parse(path, out_dir):
    return ParsedDocument(
        blocks=[ParsedBlock(type="title", text="章", level=1),
                ParsedBlock(type="text", text="本文です。", page=0)],
        page_count=1,
    )


class RecordingEmbedder(StubEmbedder):
    """embed に渡されたテキストを記録する StubEmbedder。"""
    def __init__(self, dim: int = 8):
        super().__init__(dim=dim)
        self.seen: list[str] = []

    def embed(self, texts):
        self.seen = list(texts)
        return super().embed(texts)


def _cleanup(session, store, doc_id, job_id, owner_user_id=None):
    store.drop()
    session.query(Chunk).filter_by(document_id=doc_id).delete()
    session.query(IngestJob).filter_by(id=job_id).delete()
    session.query(Document).filter_by(id=doc_id).delete()
    if owner_user_id:
        session.query(WorkspaceActivity).filter_by(owner_user_id=owner_user_id).delete()
    session.commit()
    session.close()


def test_run_ingest_persists_chunks_and_marks_ready():
    session = SessionLocal()
    owner_user_id = "u_" + uuid.uuid4().hex
    doc = Document(owner_user_id=owner_user_id, filename="x.pdf", mime="application/pdf",
                   size=10, raw_path="/tmp/x.pdf", status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id=owner_user_id, status="queued")
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
    activity = session.get(WorkspaceActivity, owner_user_id)
    assert activity is not None
    assert activity.last_document_activity_at is not None

    _cleanup(session, store, doc.id, job.id, owner_user_id)


def test_run_ingest_copies_assets_and_excludes_image_chunks(tmp_path):
    # MinerU 出力相当の images ディレクトリを用意
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
    doc = Document(owner_user_id="u1", filename="doc.pdf", mime="application/pdf",
                   size=8, raw_path=str(raw), status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id="u1", status="queued")
    session.add(job)
    session.commit()

    emb = RecordingEmbedder(dim=8)
    coll = "test_ingest_img_" + uuid.uuid4().hex[:8]
    store = QdrantStore(collection=coll, dim=8)
    run_ingest(session, store, emb, parse_with_image, doc.id, job.id)

    chunks = session.query(Chunk).filter_by(document_id=doc.id).all()
    types = {c.block_type for c in chunks}
    assert "image" in types  # 画像チャンクは PG に残る
    n_index = sum(1 for c in chunks if c.block_type != "image")
    assert store.count() == n_index  # 索引は非画像チャンクのみ
    assert all("![" not in t for t in emb.seen)  # 埋め込みに画像 markdown は無い
    # 画像が安定ディレクトリへコピーされている
    copied = Path(str(raw.with_suffix("")) + "_assets") / "images" / "a.png"
    assert copied.is_file()

    _cleanup(session, store, doc.id, job.id)


async def test_ingest_document_marks_error_when_model_setup_fails(monkeypatch):
    """run_ingest 到達前（モデル/ストア初期化）の失敗も job/doc を error にする。
    これがないとジョブは queued のまま残り、UI にエラーが出ない。"""
    session = SessionLocal()
    doc = Document(owner_user_id="u1", filename="x.pdf", mime="application/pdf",
                   size=10, raw_path="/tmp/x.pdf", status="queued")
    session.add(doc)
    session.flush()
    job = IngestJob(document_id=doc.id, owner_user_id="u1", status="queued")
    session.add(job)
    session.commit()
    doc_id, job_id = doc.id, job.id
    session.close()

    def boom():
        raise RuntimeError("model download failed")

    monkeypatch.setattr("app.worker.get_embedder", boom)

    with pytest.raises(RuntimeError):
        await ingest_document({}, doc_id, job_id)

    check = SessionLocal()
    try:
        j = check.get(IngestJob, job_id)
        d = check.get(Document, doc_id)
        assert j.status == "error"
        assert "model download failed" in (j.error or "")
        assert d.status == "error"
    finally:
        check.query(IngestJob).filter_by(id=job_id).delete()
        check.query(Document).filter_by(id=doc_id).delete()
        check.commit()
        check.close()
