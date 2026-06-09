from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_serializer


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
    candidate_k: int = Field(default=10, ge=1, le=500)
    document_ids: list[str] | None = None
    multi_hop: bool = False


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


class DocumentListItem(BaseModel):
    id: str
    filename: str
    mime: str
    size: int
    page_count: int | None = None
    status: str
    created_at: datetime
    chunk_count: int
    latest_job_id: str | None = None
    error: str | None = None


class DocumentListResponse(BaseModel):
    items: list[DocumentListItem]
    next_cursor: str | None = None
    total: int


class WorkspaceStats(BaseModel):
    indexed_document_count: int
    total_document_count: int
    connected_data_source_count: int
    last_synced_at: datetime | None = None

    @field_serializer("last_synced_at")
    def serialize_last_synced_at(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class BulkDeleteRequest(BaseModel):
    owner_user_id: str
    document_ids: list[str] = Field(max_length=1000)


class BulkDeleteResponse(BaseModel):
    deleted: list[str]
    not_found: list[str]
