from pydantic import BaseModel


class IngestStarted(BaseModel):
    document_id: str
    job_id: str


class JobStatus(BaseModel):
    document_id: str
    status: str
    progress: int
    stage_detail: str
    page_count: int | None = None
    chunks: int = 0
    error: str | None = None
