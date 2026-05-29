from pydantic import BaseModel, Field


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


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    heading_path: str
    page_start: int
    page_end: int
    block_type: str
    text: str
    expanded_text: str
    score: float


class RetrieveRequest(BaseModel):
    query: str
    rewritten: str | None = None
    owner_user_id: str
    top_k: int = Field(default=6, ge=1, le=50)
    candidate_k: int = Field(default=40, ge=1, le=500)


class RetrieveResponse(BaseModel):
    chunks: list[RetrievedChunk]


class FetchedChunk(BaseModel):
    chunk_id: str
    ordinal: int
    heading_path: str
    page_start: int
    page_end: int
    block_type: str
    text: str


class FetchDocumentRequest(BaseModel):
    owner_user_id: str
    around_chunk_id: str | None = None


class FetchDocumentResponse(BaseModel):
    document_id: str
    document_title: str
    chunks: list[FetchedChunk]
