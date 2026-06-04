"""content addressed store

Revision ID: c1d2e3f4a5b6
Revises: b7c4d9e1f2a3
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b7c4d9e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 既存データは破棄してよい（横断共有への再構築）。FK 依存順に drop。
    op.drop_table("chunks")
    op.drop_table("ingest_jobs")
    op.drop_table("documents")

    op.create_table(
        "contents",
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("raw_path", sa.String(), nullable=False),
        sa.Column("parsed_md_path", sa.String(), nullable=True),
        sa.Column("ref_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("content_hash"),
    )
    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", "content_hash", name="uq_documents_owner_content"),
    )
    op.create_index(op.f("ix_documents_owner_user_id"), "documents", ["owner_user_id"], unique=False)
    op.create_index(op.f("ix_documents_content_hash"), "documents", ["content_hash"], unique=False)
    op.create_table(
        "chunks",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading_path", sa.Text(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("token_len", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chunks_content_hash"), "chunks", ["content_hash"], unique=False)
    op.create_table(
        "ingest_jobs",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("stage_detail", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["content_hash"], ["contents.content_hash"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ingest_jobs_content_hash"), "ingest_jobs", ["content_hash"], unique=False)


def downgrade() -> None:
    # b7c4d9e1f2a3 時点のスキーマ（documents + その部分ユニークindex）を再構築する。データ移行はしない。
    op.drop_index(op.f("ix_ingest_jobs_content_hash"), table_name="ingest_jobs")
    op.drop_table("ingest_jobs")
    op.drop_index(op.f("ix_chunks_content_hash"), table_name="chunks")
    op.drop_table("chunks")
    op.drop_index(op.f("ix_documents_content_hash"), table_name="documents")
    op.drop_index(op.f("ix_documents_owner_user_id"), table_name="documents")
    op.drop_table("documents")
    op.drop_table("contents")

    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("mime", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("raw_path", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=True),
        sa.Column("parsed_md_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_documents_owner_user_id"), "documents", ["owner_user_id"], unique=False)
    # b7c4d9e1f2a3 が定義していた部分ユニークindexを復元する（後続の downgrade で drop されるため）。
    op.create_index(
        "uq_documents_owner_hash_active",
        "documents",
        ["owner_user_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("content_hash IS NOT NULL AND status != 'error'"),
    )
    op.create_table(
        "chunks",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("document_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading_path", sa.Text(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("token_len", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chunks_document_id"), "chunks", ["document_id"], unique=False)
    op.create_table(
        "ingest_jobs",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("document_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("stage_detail", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ingest_jobs_document_id"), "ingest_jobs", ["document_id"], unique=False)
    op.create_index(op.f("ix_ingest_jobs_owner_user_id"), "ingest_jobs", ["owner_user_id"], unique=False)
