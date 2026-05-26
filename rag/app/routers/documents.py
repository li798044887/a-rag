import uuid
from pathlib import Path

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

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
    try:
        await pool.enqueue_job("ingest_document", document_id, job_id)
    finally:
        await pool.aclose()


def _mark_enqueue_failed(document_id: str, job_id: str, reason: str) -> None:
    """enqueue 失敗時、新規セッションで job/document を error にする。"""
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        doc = session.get(Document, document_id)
        if job:
            job.status = "error"
            job.error = reason
        if doc:
            doc.status = "error"
        session.commit()
    finally:
        session.close()


@router.post("/documents", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def create_document(file: UploadFile = File(...), owner_user_id: str = Form(...)):
    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "file").name
    raw_path = upload_dir / f"{uuid.uuid4().hex}_{safe_name}"
    raw_path.write_bytes(await file.read())

    try:
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
    except Exception:
        raw_path.unlink(missing_ok=True)
        raise

    try:
        await enqueue_ingest(result.document_id, result.job_id)
    except Exception as exc:  # noqa: BLE001
        _mark_enqueue_failed(result.document_id, result.job_id, f"enqueue failed: {exc}")
        raise HTTPException(status_code=502, detail="ingest enqueue failed") from exc

    return result


@router.post("/jobs/{job_id}/retry", response_model=IngestStarted,
             dependencies=[Depends(require_internal_token)])
async def retry_job(job_id: str):
    session = SessionLocal()
    try:
        from app.models import IngestJob
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        job.status = "queued"; job.progress = 0; job.error = None; job.stage_detail = ""
        session.commit()
        result = IngestStarted(document_id=job.document_id, job_id=job.id)
    finally:
        session.close()
    await enqueue_ingest(result.document_id, result.job_id)
    return result
