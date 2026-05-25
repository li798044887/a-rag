from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionLocal
from app.models import Chunk, Document, IngestJob
from app.schemas import JobStatus
from app.security import require_internal_token

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus,
            dependencies=[Depends(require_internal_token)])
def get_job(job_id: str):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        doc = session.get(Document, job.document_id)
        chunks = session.query(Chunk).filter_by(document_id=job.document_id).count()
        return JobStatus(
            document_id=job.document_id, status=job.status, progress=job.progress,
            stage_detail=job.stage_detail, page_count=doc.page_count if doc else None,
            chunks=chunks, error=job.error,
        )
    finally:
        session.close()
