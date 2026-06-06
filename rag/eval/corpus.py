import hashlib
import mimetypes
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
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
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    for filename in filenames:
        path = files_dir / filename
        data = path.read_bytes()
        content_hash = hashlib.sha256(data).hexdigest()

        # MinerU は raw_path の隣に <stem>_mineru/ を書き出すため、raw_path は書込可能な
        # upload_dir 配下に置く（read-only マウントの原本を直接指さない）。本番アップロードと同じ。
        raw_path = upload_dir / f"{content_hash}{path.suffix}"
        if not raw_path.exists():
            raw_path.write_bytes(data)

        content = session.get(Content, content_hash)
        if content is None:
            mime = mimetypes.guess_type(path.name)[0] or "text/plain"
            content = Content(content_hash=content_hash, mime=mime,
                              size=len(data), raw_path=str(raw_path),
                              status="queued", ref_count=0)
            session.add(content)
            session.flush()
        elif content.raw_path != str(raw_path):
            # 旧 raw_path（read-only マウント等）を書込可能パスへ補正してから再取り込み。
            content.raw_path = str(raw_path)

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
