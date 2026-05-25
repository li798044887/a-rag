import uuid
from pathlib import Path

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.config import settings
from app.db import SessionLocal
from app.models import Document, IngestJob
from app.queue import redis_settings
from app.schemas import IngestStarted
from app.security import require_internal_token

router = APIRouter()


def _upload_dir() -> Path:
    return Path(settings.upload_dir)


async def enqueue_ingest(document_id: str, job_id: str) -> None:
    pool = await create_pool(redis_settings())
    await pool.enqueue_job("ingest_document", document_id, job_id)


@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    raw_path = upload_dir / f"{uuid.uuid4().hex}_{file.filename}"
    raw_path.write_bytes(await file.read())

    session = SessionLocal()
    try:
        doc = Document(owner_user_id=owner_user_id, filename=file.filename or "file",
                       mime=file.content_type or "application/octet-stream",
                       size=raw_path.stat().st_size, raw_path=str(raw_path), status="queued")
        session.add(doc)
        session.flush()
        job = IngestJob(document_id=doc.id, owner_user_id=owner_user_id, status="queued")
        session.add(job)
        session.commit()
        result = IngestStarted(document_id=doc.id, job_id=job.id)
    finally:
        session.close()

    await enqueue_ingest(result.document_id, result.job_id)
    return result
