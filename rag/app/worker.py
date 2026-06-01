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
from app.models import Chunk, Document, IngestJob
from app.parsing.dispatch import parse_document
from app.parsing.types import ParsedDocument
from app.queue import redis_settings
from app.vectorstore.qdrant import QdrantStore

ParseFn = Callable[[str, str], ParsedDocument]


def _set(job: IngestJob, doc: Document, session: Session, *,
         status: str, progress: int, detail: str = "") -> None:
    job.status = status
    job.progress = progress
    job.stage_detail = detail
    doc.status = status if status in ("ready", "error") else "processing"
    if status == "ready":
        record_workspace_activity(session, owner_user_id=doc.owner_user_id)
    session.commit()


def _copy_assets(parsed: ParsedDocument, raw_path: str) -> None:
    """MinerU が出力した images/ を、文書ごとの安定ディレクトリへ複製する。
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
               parse_fn: ParseFn, document_id: str, job_id: str) -> None:
    doc = session.get(Document, document_id)
    job = session.get(IngestJob, job_id)
    if not doc or not job:
        # キャンセル等で行が消えた後に Worker が拾った場合。エラーにせず no-op で終える。
        return
    try:
        store.ensure_collection()

        # 冪等化: 再実行/再アップロード時に旧チャンク(PG)と旧ベクトル(Qdrant)を掃除。
        # 初回実行では no-op、再実行ではクリーンに再構築される。
        session.query(Chunk).filter_by(document_id=doc.id).delete()
        session.commit()
        store.delete_by_document(doc.id)

        _set(job, doc, session, status="parsing", progress=10, detail="解析中")
        out_dir = str(Path(doc.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(doc.raw_path, out_dir)
        doc.page_count = parsed.page_count
        _copy_assets(parsed, doc.raw_path)

        _set(job, doc, session, status="chunking", progress=40, detail="チャンク化")
        chunks = chunk_blocks(parsed.blocks)
        rows = []
        for ch in chunks:
            row = Chunk(document_id=doc.id, ordinal=ch.ordinal, heading_path=ch.heading_path,
                        page_start=ch.page_start, page_end=ch.page_end,
                        block_type=ch.block_type, token_len=ch.token_len, text=ch.text)
            session.add(row)
            rows.append((row, ch))
        session.flush()

        # 画像チャンクは表示専用: PG には残すが埋め込み・Qdrant 索引からは除外する。
        index_rows = [(row, ch) for row, ch in rows if ch.block_type != "image"]

        _set(job, doc, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in index_rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, doc, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "document_id": doc.id, "owner_user_id": doc.owner_user_id,
                "heading_path": ch.heading_path, "page_start": ch.page_start, "page_end": ch.page_end,
                "block_type": ch.block_type, "source_type": "doc", "text": ch.text,
                "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(index_rows)
        ])

        _set(job, doc, session, status="ready", progress=100, detail="完了")
    except Exception as exc:  # noqa: BLE001
        job.status = "error"
        job.error = str(exc)
        doc.status = "error"
        session.commit()
        raise


async def ingest_document(ctx: dict, document_id: str, job_id: str) -> None:
    session = SessionLocal()
    try:
        # モデル/ストア初期化は run_ingest の外なので、ここで失敗すると job が
        # queued のまま残り UI にエラーが出ない。失敗を job/doc に記録してから再送出する。
        try:
            embedder = get_embedder()
            store = QdrantStore(dim=embedder.dim)
        except Exception as exc:  # noqa: BLE001
            job = session.get(IngestJob, job_id)
            doc = session.get(Document, document_id)
            if job:
                job.status = "error"
                job.error = str(exc)
            if doc:
                doc.status = "error"
            session.commit()
            raise
        await asyncio.to_thread(
            run_ingest, session, store, embedder, parse_document, document_id, job_id
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
            .filter(IngestJob.status.in_(("queued", "parsing", "chunking", "embedding", "indexing")))
            .all()
        )
        for job in jobs:
            job.status = "queued"
            job.progress = 0
            job.stage_detail = ""
            job.error = None
            doc = session.get(Document, job.document_id)
            if doc:
                doc.status = "queued"
            await redis.enqueue_job(
                "ingest_document",
                job.document_id,
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
    # MinerU / embedding / Qdrant upsert are CPU- and memory-heavy.
    # Keep local ingestion stable by processing documents one at a time.
    max_jobs = 1
    # CPU での MinerU 解析 + BGE-M3 埋め込みは数分かかるため、arq 既定の 300s を大幅に延長。
    # max_tries=1: 長時間ジョブのタイムアウト自動再試行による二重実行を避ける（再試行は /jobs/{id}/retry で明示的に行う）。
    job_timeout = 3600
    max_tries = 1
