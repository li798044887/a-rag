from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionLocal
from app.models import Chunk, Content, Document, IngestJob
from app.schemas import JobStatus
from app.security import require_internal_token

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus,
            dependencies=[Depends(require_internal_token)])
def get_job(job_id: str, owner_user_id: str | None = None):
    session = SessionLocal()
    try:
        job = session.get(IngestJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        content_hash = job.content_hash
        # owner 指定時は library entry 所有を強制（IDOR 防止）。
        if owner_user_id is not None:
            doc = (session.query(Document)
                   .filter_by(owner_user_id=owner_user_id, content_hash=content_hash)
                   .one_or_none())
            if doc is None:
                raise HTTPException(status_code=404, detail="job not found")
        else:
            doc = session.query(Document).filter_by(content_hash=content_hash).first()
        content = session.get(Content, content_hash)
        chunks = session.query(Chunk).filter_by(content_hash=content_hash).count()
        return JobStatus(
            document_id=doc.id if doc else content_hash, status=job.status,
            progress=job.progress, stage_detail=job.stage_detail,
            page_count=content.page_count if content else None,
            chunks=chunks, error=job.error,
        )
    finally:
        session.close()
