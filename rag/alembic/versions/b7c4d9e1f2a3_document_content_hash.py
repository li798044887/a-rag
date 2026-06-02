"""document content_hash

Revision ID: b7c4d9e1f2a3
Revises: 5b8a1f4c2d91
Create Date: 2026-06-02 00:00:00.000000

"""
import hashlib
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c4d9e1f2a3"
down_revision: Union[str, Sequence[str], None] = "5b8a1f4c2d91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("content_hash", sa.String(), nullable=True))

    # 既存行のバックフィル（ベストエフォート）: raw_path を読み SHA-256 を埋める。
    # ファイル不在・読込失敗はスキップして NULL のまま残す。
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, raw_path FROM documents")).fetchall()
    for row in rows:
        try:
            data = Path(row.raw_path).read_bytes()
        except OSError:
            continue
        digest = hashlib.sha256(data).hexdigest()
        bind.execute(
            sa.text("UPDATE documents SET content_hash = :h WHERE id = :id"),
            {"h": digest, "id": row.id},
        )

    # 同一ユーザー・同一内容で error 以外が同時に2行存在することを禁止する部分ユニークindex。
    op.create_index(
        "uq_documents_owner_hash_active",
        "documents",
        ["owner_user_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("content_hash IS NOT NULL AND status != 'error'"),
    )


def downgrade() -> None:
    op.drop_index("uq_documents_owner_hash_active", table_name="documents")
    op.drop_column("documents", "content_hash")
