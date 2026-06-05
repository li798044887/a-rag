import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from app.embedding.base import Embedder
from app.models import Content, Document, IngestJob
from app.parsing.dispatch import parse_document
from app.vectorstore.qdrant import QdrantStore
from app.worker import run_ingest


class MissingDocumentsError(RuntimeError):
    pass


def resolve(session: Session, owner: str,
            filenames: list[str]) -> dict[str, tuple[str, str]]:
    """filename -> (document_id, content_hash)。未取り込みは MissingDocumentsError。"""
    rows = (session.query(Document.filename, Document.id, Document.content_hash)
            .filter(Document.owner_user_id == owner,
                    Document.filename.in_(filenames))
            .all())
    mapping = {fn: (did, ch) for fn, did, ch in rows}
    missing = [fn for fn in filenames if fn not in mapping]
    if missing:
        raise MissingDocumentsError(
            "未取り込みの文書があります: " + ", ".join(missing)
            + "  先に `python -m eval ingest` を実行してください。")
    return mapping


def ingest_files(session: Session, store: QdrantStore, embedder: Embedder,
                 owner: str, files_dir: str | Path, filenames: list[str]) -> None:
    """原本を owner で取り込む。既存 content/document は冪等スキップ。実 parse を同期実行。"""
    files_dir = Path(files_dir)
    for filename in filenames:
        path = files_dir / filename
        data = path.read_bytes()
        content_hash = hashlib.sha256(data).hexdigest()

        content = session.get(Content, content_hash)
        if content is None:
            # eval は原本（docs/demo-files/）を複製せず直接 raw_path に指す。run_ingest が
            # content.raw_path を parse 入力に使うため、解析時にアクセス可能であること。
            content = Content(content_hash=content_hash, mime="application/pdf",
                              size=len(data), raw_path=str(path),
                              status="queued", ref_count=0)
            session.add(content)
            session.flush()

        doc = (session.query(Document)
               .filter_by(owner_user_id=owner, content_hash=content_hash)
               .one_or_none())
        if doc is None:
            session.add(Document(owner_user_id=owner, content_hash=content_hash,
                                 filename=filename))
            content.ref_count = content.ref_count + 1

        if content.status != "ready":
            job = IngestJob(content_hash=content_hash, status="queued")
            session.add(job)
            session.flush()
            run_ingest(session, store, embedder, parse_document, content_hash, job.id)
        session.commit()
