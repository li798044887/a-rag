import uuid
from pathlib import Path

from arq import create_pool
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.db import SessionLocal
from app.documents_service import select_chunks
from app.models import Chunk, Document, IngestJob
from app.queue import redis_settings
from app.schemas import FetchDocumentRequest, FetchDocumentResponse, FetchedChunk, IngestStarted
from app.security import require_internal_token

router = APIRouter()


def _upload_dir() -> Path:
    return Path(settings.upload_dir)


async def enqueue_ingest(document_id: str, job_id: str) -> None:
    pool = await create_pool(redis_settings())
    try:
        await pool.enqueue_job("ingest_document", document_id, job_id, _job_id=job_id)
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
async def retry_job(job_id: str, owner_user_id: str | None = None):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        # owner_user_id が渡された場合は所有者一致を強制（web 経由の IDOR を防ぐ）。
        if not job or (owner_user_id is not None and job.owner_user_id != owner_user_id):
            raise HTTPException(status_code=404, detail="job not found")
        if job.status not in ("ready", "error"):
            raise HTTPException(status_code=409, detail=f"job is {job.status}, cannot retry")
        job.status = "queued"; job.progress = 0; job.error = None; job.stage_detail = ""
        doc = session.get(Document, job.document_id)
        if doc:
            doc.status = "queued"
        session.commit()
        result = IngestStarted(document_id=job.document_id, job_id=job.id)
    finally:
        session.close()
    await enqueue_ingest(result.document_id, result.job_id)
    return result


def _fetch_document(document_id: str, req: FetchDocumentRequest) -> FetchDocumentResponse:
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != req.owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        rows = (session.query(Chunk)
                .filter(Chunk.document_id == document_id)
                .order_by(Chunk.ordinal).all())
        around = None
        if req.around_chunk_id:
            center = next((c for c in rows if c.id == req.around_chunk_id), None)
            # around_chunk_id が見つからない場合は窓掛けせず先頭から返す（意図的フォールバック）
            around = center.ordinal if center else None
        rows = select_chunks(rows, around_ordinal=around)
        return FetchDocumentResponse(
            document_id=doc.id, document_title=doc.filename,
            chunks=[FetchedChunk(chunk_id=c.id, ordinal=c.ordinal, heading_path=c.heading_path,
                                 page_start=c.page_start, page_end=c.page_end,
                                 block_type=c.block_type, text=c.text) for c in rows])
    finally:
        session.close()


@router.post("/documents/{document_id}/chunks", response_model=FetchDocumentResponse,
             dependencies=[Depends(require_internal_token)])
def fetch_document_chunks(document_id: str, req: FetchDocumentRequest):
    return _fetch_document(document_id, req)


@router.get("/documents/{document_id}/raw",
            dependencies=[Depends(require_internal_token)])
def get_document_raw(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = Path(doc.raw_path)
        mime = doc.mime
        filename = doc.filename
    finally:
        session.close()
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(
        str(raw_path),
        media_type=mime or "application/octet-stream",
        filename=filename,
        content_disposition_type="inline",
    )
