import asyncio
import shutil
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from app.chunking.chunker import chunk_blocks
from app.db import SessionLocal
from app.documents_service import assets_dir_for, record_workspace_activity
from app.embedding.base import Embedder
from app.embedding.factory import get_embedder
from app.models import Chunk, Content, Document, IngestJob
from app.parsing.dispatch import parse_document
from app.parsing.ocr import ocr_images
from app.parsing.types import ParsedDocument
from app.queue import redis_settings
from app.vectorstore.qdrant import QdrantStore

ParseFn = Callable[[str, str], ParsedDocument]


def _set(job: IngestJob, content: Content, session: Session, *,
         status: str, progress: int, detail: str = "") -> None:
    job.status = status
    job.progress = progress
    job.stage_detail = detail
    content.status = status if status in ("ready", "error") else "processing"
    if status == "ready":
        # この content を参照する全 owner の活動時刻を更新する。
        owners = (session.query(Document.owner_user_id)
                  .filter(Document.content_hash == content.content_hash)
                  .distinct().all())
        for (owner,) in owners:
            record_workspace_activity(session, owner_user_id=owner)
    session.commit()


def _copy_assets(parsed: ParsedDocument, raw_path: str) -> None:
    """MinerU が出力した images/ を、実体ごとの安定ディレクトリへ複製する。
    再実行時は作り直す（冪等）。画像が無ければ何もしない。"""
    if not parsed.images_dir:
        return
    src = Path(parsed.images_dir) / "images"
    if not src.is_dir():
        return
    dst = Path(assets_dir_for(raw_path)) / "images"
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def run_ingest(session: Session, store: QdrantStore, embedder: Embedder,
               parse_fn: ParseFn, content_hash: str, job_id: str) -> None:
    content = session.get(Content, content_hash)
    job = session.get(IngestJob, job_id)
    if not content or not job:
        # キャンセル等で行が消えた後に Worker が拾った場合。エラーにせず no-op で終える。
        return
    try:
        store.ensure_collection()

        # 冪等化: 再実行/再アップロード時に旧チャンク(PG)と旧ベクトル(Qdrant)を掃除。
        session.query(Chunk).filter_by(content_hash=content.content_hash).delete()
        session.commit()
        store.delete_by_content(content.content_hash)

        _set(job, content, session, status="parsing", progress=10, detail="解析中")
        out_dir = str(Path(content.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(content.raw_path, out_dir)
        content.page_count = parsed.page_count
        _copy_assets(parsed, content.raw_path)

        # OCR: 画像内の文字を認識して ParsedBlock.ocr_text に書き込む
        parsed.blocks = ocr_images(parsed.blocks, images_dir=assets_dir_for(content.raw_path))

        _set(job, content, session, status="chunking", progress=40, detail="チャンク化")
        chunks = chunk_blocks(parsed.blocks)
        rows = []
        for ch in chunks:
            row = Chunk(content_hash=content.content_hash, ordinal=ch.ordinal,
                        heading_path=ch.heading_path, page_start=ch.page_start,
                        page_end=ch.page_end, block_type=ch.block_type,
                        token_len=ch.token_len, text=ch.text)
            session.add(row)
            rows.append((row, ch))
        session.flush()

        # 画像チャンクは表示専用: PG には残すが埋め込み・Qdrant 索引からは除外する。
        index_rows = [(row, ch) for row, ch in rows if ch.block_type != "image"]

        _set(job, content, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in index_rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, content, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "content_hash": content.content_hash,
                "heading_path": ch.heading_path, "page_start": ch.page_start,
                "page_end": ch.page_end, "block_type": ch.block_type,
                "source_type": "doc", "text": ch.text, "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(index_rows)
        ])

        _set(job, content, session, status="ready", progress=100, detail="完了")
    except Exception as exc:  # noqa: BLE001
        job.status = "error"
        job.error = str(exc)
        content.status = "error"
        content.error = str(exc)
        session.commit()
        raise


async def ingest_document(ctx: dict, content_hash: str, job_id: str) -> None:
    session = SessionLocal()
    try:
        try:
            embedder = get_embedder()
            store = QdrantStore(dim=embedder.dim)
        except Exception as exc:  # noqa: BLE001
            job = session.get(IngestJob, job_id)
            content = session.get(Content, content_hash)
            if job:
                job.status = "error"
                job.error = str(exc)
            if content:
                content.status = "error"
                content.error = str(exc)
            session.commit()
            raise
        await asyncio.to_thread(
            run_ingest, session, store, embedder, parse_document, content_hash, job_id
        )
    finally:
        session.close()


async def requeue_interrupted_jobs(ctx: dict) -> None:
    """Worker 再起動時、DB と Redis キューのズレを修復する。"""
    redis = ctx["redis"]
    session = SessionLocal()
    try:
        jobs = (
            session.query(IngestJob)
            .filter(IngestJob.status.in_(("parsing", "chunking", "embedding", "indexing")))
            .all()
        )
        for job in jobs:
            job.status = "queued"
            job.progress = 0
            job.stage_detail = ""
            job.error = None
            content = session.get(Content, job.content_hash)
            if content:
                content.status = "queued"
            await redis.enqueue_job(
                "ingest_document",
                job.content_hash,
                job.id,
                _job_id=job.id,
            )
        session.commit()
    finally:
        session.close()


class WorkerSettings:
    functions = [ingest_document]
    on_startup = requeue_interrupted_jobs
    redis_settings = redis_settings()
    # MinerU 解析は CPU 主体、embedding は GPU。2 並列でスループット向上。
    max_jobs = 2
    # CPU での MinerU 解析 + BGE-M3 埋め込みは数分かかるため、arq 既定の 300s を大幅に延長。
    # max_tries=1: 長時間ジョブのタイムアウト自動再試行による二重実行を避ける（再試行は /jobs/{id}/retry で明示的に行う）。
    job_timeout = 3600
    max_tries = 1
