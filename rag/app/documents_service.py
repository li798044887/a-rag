"""文書チャンクの選択ロジック（窓掛け・上限）。DB I/O は含まない純関数。"""

import base64
import shutil
from datetime import datetime
from pathlib import Path

MAX_CHUNKS = 40
WINDOW = 2


def select_chunks(chunks, *, around_ordinal, window=WINDOW, max_chunks=MAX_CHUNKS):
    """ordinal 昇順前提の chunks から、窓掛け（around 指定時）と上限を適用して返す。"""
    if around_ordinal is not None:
        lo, hi = around_ordinal - window, around_ordinal + window
        chunks = [c for c in chunks if lo <= c.ordinal <= hi]
    return chunks[:max_chunks]


def assets_dir_for(raw_path: str) -> str:
    """原本パスから、抽出画像を置く安定ディレクトリを決定的に導出する。"""
    return str(Path(raw_path).with_suffix("")) + "_assets"


def mineru_dir_for(raw_path: str) -> str:
    """原本パスから MinerU 生出力ディレクトリを決定的に導出する（worker の out_dir と一致）。"""
    return str(Path(raw_path).with_suffix("")) + "_mineru"


def cleanup_document_files(raw_path: str, parsed_md_path: str | None = None) -> None:
    """文書に紐づく実体（原本・解析MD・_assets・_mineru）を best-effort で削除する。"""
    for f in (raw_path, parsed_md_path):
        if f:
            Path(f).unlink(missing_ok=True)
    for d in (assets_dir_for(raw_path), mineru_dir_for(raw_path)):
        shutil.rmtree(d, ignore_errors=True)


def resolve_within(base: str, rel: str) -> Path | None:
    """base 配下に解決される実パスを返す。base の外へ出る場合は None（トラバーサル防御）。"""
    base_p = Path(base).resolve()
    target = (base_p / rel).resolve()
    try:
        target.relative_to(base_p)
    except ValueError:
        return None
    return target


def encode_cursor(created_at: datetime, doc_id: str) -> str:
    """created_at と doc_id を base64url エンコードした opaque cursor として返す。"""
    raw = f"{created_at.isoformat()}|{doc_id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    """opaque cursor をデコードして (created_at, doc_id) タプルを返す。"""
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts, doc_id = raw.split("|", 1)
    return datetime.fromisoformat(ts), doc_id


def list_documents(session, *, owner_user_id: str, limit: int = 30,
                   cursor: str | None = None, q: str | None = None,
                   status: str | None = None):
    """所有者の文書一覧をキーセット・ページングで返す（chunk件数/最新ジョブを一括取得）。"""
    from sqlalchemy import func, tuple_

    from app.models import Chunk, Document, IngestJob
    from app.schemas import DocumentListItem, DocumentListResponse

    def _base():
        q_ = session.query(Document).filter(Document.owner_user_id == owner_user_id)
        if q:
            q_ = q_.filter(Document.filename.ilike(f"%{q}%"))
        if status:
            q_ = q_.filter(Document.status == status)
        return q_

    total = _base().count()

    page = _base().order_by(Document.created_at.desc(), Document.id.desc())
    if cursor:
        ts, cid = decode_cursor(cursor)
        page = page.filter(tuple_(Document.created_at, Document.id) < (ts, cid))
    docs = page.limit(limit + 1).all()
    has_more = len(docs) > limit
    docs = docs[:limit]

    doc_ids = [d.id for d in docs]
    counts = dict(
        session.query(Chunk.document_id, func.count(Chunk.id))
        .filter(Chunk.document_id.in_(doc_ids))
        .group_by(Chunk.document_id)
        .all()
    ) if doc_ids else {}
    latest_job: dict[str, object] = {}
    if doc_ids:
        for j in (session.query(IngestJob)
                  .filter(IngestJob.document_id.in_(doc_ids))
                  .order_by(IngestJob.created_at.desc())
                  .all()):
            latest_job.setdefault(j.document_id, j)

    items = [
        DocumentListItem(
            id=d.id, filename=d.filename, mime=d.mime, size=d.size,
            page_count=d.page_count, status=d.status, created_at=d.created_at,
            chunk_count=counts.get(d.id, 0),
            latest_job_id=getattr(latest_job.get(d.id), "id", None),
            error=getattr(latest_job.get(d.id), "error", None),
        )
        for d in docs
    ]
    next_cursor = (
        encode_cursor(docs[-1].created_at, docs[-1].id) if has_more and docs else None
    )
    return DocumentListResponse(items=items, next_cursor=next_cursor, total=total)
