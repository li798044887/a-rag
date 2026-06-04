"""文書チャンクの選択ロジック（窓掛け・上限）。DB I/O は含まない純関数。"""

import base64
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_CHUNKS = 40
WINDOW = 2

# LibreOffice で PDF 化してブラウザプレビューできる形式（拡張子・小文字）。
# PDF/画像は既にプレビュー可能、CSV/TXT は解析テキストで足りるため対象外。
CONVERTIBLE_EXTS = {
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
}
# soffice 変換のタイムアウト（秒）。巨大ブック等での無限待ちを防ぐ。
CONVERT_TIMEOUT = 120


def is_convertible(path: str) -> bool:
    """原本パス/ファイル名の拡張子が LibreOffice→PDF 変換対象かを返す。"""
    return Path(path).suffix.lstrip(".").lower() in CONVERTIBLE_EXTS


def rendered_pdf_for(raw_path: str) -> Path:
    """原本パスから、レンダリング済み PDF のキャッシュパスを決定的に導出する。"""
    return Path(str(Path(raw_path).with_suffix("")) + "_rendered.pdf")


def convert_to_pdf(raw_path: str) -> Path:
    """原本を LibreOffice headless で PDF 化し、キャッシュパスへ確定して返す。

    既にキャッシュ済みなら soffice を起動せずそれを返す。並行起動時の
    プロファイル衝突を避けるため毎回ユニークな UserInstallation を渡し、
    一時ディレクトリへ出力してから os.replace でアトミックに確定する。
    """
    cache = rendered_pdf_for(raw_path)
    if cache.is_file():
        return cache

    raw = Path(raw_path)
    cache.parent.mkdir(parents=True, exist_ok=True)
    # 一時ディレクトリは出力先と同じファイルシステム上に作る。/tmp（コンテナ rootfs）と
    # /data/uploads（Docker ボリューム）は別デバイスのため、またいで os.replace すると
    # cross-device link (Errno 18) で失敗する。同一FS内なら rename はアトミック。
    with tempfile.TemporaryDirectory(prefix=".soffice_", dir=cache.parent) as tmp:
        profile = Path(tmp) / "profile"
        subprocess.run(
            [
                "soffice", "--headless", "--nologo", "--nofirststartwizard",
                f"-env:UserInstallation=file://{profile}",
                "--convert-to", "pdf", "--outdir", tmp, str(raw),
            ],
            check=True, capture_output=True, timeout=CONVERT_TIMEOUT,
        )
        produced = Path(tmp) / (raw.stem + ".pdf")
        if not produced.is_file():
            raise RuntimeError(f"soffice produced no pdf for {raw_path}")
        os.replace(produced, cache)
    return cache


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


def _find_mineru_pdf(raw_path: str, suffix: str) -> Path | None:
    """MinerU 生出力配下の指定 suffix PDF を探して返す。無ければ None。"""
    base = Path(mineru_dir_for(raw_path))
    if not base.is_dir():
        return None
    matches = sorted(base.rglob(f"*_{suffix}.pdf"))
    return matches[-1] if matches else None


def find_layout_pdf(raw_path: str) -> Path | None:
    """MinerU 生出力配下のレイアウト注釈付き PDF（*_layout.pdf）を探して返す。無ければ None。"""
    return _find_mineru_pdf(raw_path, "layout")


def find_span_pdf(raw_path: str) -> Path | None:
    """MinerU 生出力配下の span 注釈付き PDF（*_span.pdf）を探して返す。無ければ None。"""
    return _find_mineru_pdf(raw_path, "span")


def cleanup_document_files(raw_path: str, parsed_md_path: str | None = None) -> None:
    """文書に紐づく実体（原本・解析MD・_rendered.pdf・_assets・_mineru）を best-effort で削除する。"""
    for f in (raw_path, parsed_md_path):
        if f:
            Path(f).unlink(missing_ok=True)
    if raw_path:
        rendered_pdf_for(raw_path).unlink(missing_ok=True)
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
    """所有者の参照(library entry)一覧をキーセット・ページングで返す。
    mime/size/page_count/status は共有 content から JOIN し、chunk件数/最新ジョブは
    content_hash 単位で一括取得する。"""
    from sqlalchemy import func, tuple_

    from app.models import Chunk, Content, Document, IngestJob
    from app.schemas import DocumentListItem, DocumentListResponse

    def _base():
        q_ = (session.query(Document, Content)
              .join(Content, Document.content_hash == Content.content_hash)
              .filter(Document.owner_user_id == owner_user_id))
        if q:
            q_ = q_.filter(Document.filename.ilike(f"%{q}%"))
        if status:
            q_ = q_.filter(Content.status == status)
        return q_

    total = _base().count()

    page = _base().order_by(Document.created_at.desc(), Document.id.desc())
    if cursor:
        try:
            ts, cid = decode_cursor(cursor)
        except Exception as exc:  # noqa: BLE001 — 不正/破損カーソルは 400 にする
            raise ValueError("invalid cursor") from exc
        page = page.filter(tuple_(Document.created_at, Document.id) < (ts, cid))
    rows = page.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    hashes = [c.content_hash for _, c in rows]
    counts = dict(
        session.query(Chunk.content_hash, func.count(Chunk.id))
        .filter(Chunk.content_hash.in_(hashes))
        .group_by(Chunk.content_hash)
        .all()
    ) if hashes else {}
    latest_job: dict[str, object] = {}
    if hashes:
        for j in (session.query(IngestJob)
                  .filter(IngestJob.content_hash.in_(hashes))
                  .order_by(IngestJob.created_at.desc())
                  .all()):
            latest_job.setdefault(j.content_hash, j)

    items = [
        DocumentListItem(
            id=d.id, filename=d.filename, mime=c.mime, size=c.size,
            page_count=c.page_count, status=c.status, created_at=d.created_at,
            chunk_count=counts.get(c.content_hash, 0),
            latest_job_id=getattr(latest_job.get(c.content_hash), "id", None),
            error=getattr(latest_job.get(c.content_hash), "error", None),
        )
        for d, c in rows
    ]
    next_cursor = (
        encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None
    )
    return DocumentListResponse(items=items, next_cursor=next_cursor, total=total)

def record_workspace_activity(session, *, owner_user_id: str) -> None:
    """ドキュメント集合が変わった時刻を owner 単位で記録する。"""
    from app.models import WorkspaceActivity

    row = session.get(WorkspaceActivity, owner_user_id)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if row:
        row.last_document_activity_at = now
        return
    session.add(WorkspaceActivity(
        owner_user_id=owner_user_id,
        last_document_activity_at=now,
    ))


def workspace_stats(session, *, owner_user_id: str):
    """所有者のワークスペース統計を返す。indexed は content.status=ready の参照数。"""
    from app.models import Content, Document, WorkspaceActivity
    from app.schemas import WorkspaceStats

    total = session.query(Document).filter(Document.owner_user_id == owner_user_id).count()
    indexed = (
        session.query(Document)
        .join(Content, Document.content_hash == Content.content_hash)
        .filter(Document.owner_user_id == owner_user_id, Content.status == "ready")
        .count()
    )
    activity = (
        session.query(WorkspaceActivity)
        .filter(WorkspaceActivity.owner_user_id == owner_user_id)
        .limit(1)
        .all()
    )
    last_synced_at = activity[0].last_document_activity_at if activity else None
    return WorkspaceStats(
        indexed_document_count=indexed,
        total_document_count=total,
        connected_data_source_count=1 if total > 0 else 0,
        last_synced_at=last_synced_at,
    )
