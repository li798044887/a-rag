import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    filename: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    raw_path: Mapped[str] = mapped_column(String)
    parsed_md_path: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document")


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[str] = mapped_column(Text, default="")
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String)
    token_len: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    document: Mapped[Document] = relationship(back_populates="chunks")


class IngestJob(Base):
    __tablename__ = "ingest_jobs"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0–100
    stage_detail: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
