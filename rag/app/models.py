import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Content(Base):
    """同一バイトのファイル実体。content_hash 単位で 1 個だけ存在し、
    原本・解析成果物・チャンク・ベクトル・ジョブを所有する。ref_count が 0 で GC。"""
    __tablename__ = "contents"
    content_hash: Mapped[str] = mapped_column(String, primary_key=True)
    mime: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_path: Mapped[str] = mapped_column(String)
    parsed_md_path: Mapped[str | None] = mapped_column(String, nullable=True)
    ref_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Document(Base):
    """ユーザーごとの参照（library entry）。id は web/citations の識別子として据え置き。"""
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "content_hash", name="uq_documents_owner_content"),
    )
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    owner_user_id: Mapped[str] = mapped_column(String, index=True)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    filename: Mapped[str] = mapped_column(String)  # ユーザー固有（同一バイトでも名前は別々）
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[str] = mapped_column(Text, default="")
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String)
    token_len: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)


class IngestJob(Base):
    __tablename__ = "ingest_jobs"
    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    content_hash: Mapped[str] = mapped_column(ForeignKey("contents.content_hash"), index=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0–100
    stage_detail: Mapped[str] = mapped_column(String, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class WorkspaceActivity(Base):
    __tablename__ = "workspace_activity"
    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    last_document_activity_at: Mapped[datetime] = mapped_column(server_default=func.now())
