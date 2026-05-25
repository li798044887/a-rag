import asyncio
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from app.chunking.chunker import chunk_blocks
from app.db import SessionLocal
from app.embedding.base import Embedder
from app.embedding.factory import get_embedder
from app.models import Chunk, Document, IngestJob
from app.parsing.mineru import parse as mineru_parse
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
    session.commit()


def run_ingest(session: Session, store: QdrantStore, embedder: Embedder,
               parse_fn: ParseFn, document_id: str, job_id: str) -> None:
    doc = session.get(Document, document_id)
    job = session.get(IngestJob, job_id)
    if not doc or not job:
        raise RuntimeError(f"document or job not found: doc={document_id} job={job_id}")
    try:
        store.ensure_collection()

        _set(job, doc, session, status="parsing", progress=10, detail="MinerU 解析中")
        out_dir = str(Path(doc.raw_path).with_suffix("")) + "_mineru"
        parsed = parse_fn(doc.raw_path, out_dir)
        doc.page_count = parsed.page_count

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

        _set(job, doc, session, status="embedding", progress=70, detail="埋め込み生成")
        texts = [f"{ch.heading_path}\n\n{ch.text}".strip() for _, ch in rows]
        vectors = embedder.embed(texts) if texts else []

        _set(job, doc, session, status="indexing", progress=90, detail="索引化")
        store.upsert([
            {
                "chunk_id": row.id, "document_id": doc.id, "owner_user_id": doc.owner_user_id,
                "heading_path": ch.heading_path, "page_start": ch.page_start, "page_end": ch.page_end,
                "block_type": ch.block_type, "source_type": "doc", "text": ch.text,
                "vector": vectors[i],
            }
            for i, (row, ch) in enumerate(rows)
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
        embedder = get_embedder()
        store = QdrantStore(dim=embedder.dim)
        await asyncio.to_thread(
            run_ingest, session, store, embedder, mineru_parse, document_id, job_id
        )
    finally:
        session.close()


class WorkerSettings:
    functions = [ingest_document]
    redis_settings = redis_settings()
