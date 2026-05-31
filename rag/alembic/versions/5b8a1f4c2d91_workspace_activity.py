"""workspace activity

Revision ID: 5b8a1f4c2d91
Revises: e2a9ffce7300
Create Date: 2026-05-31 23:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5b8a1f4c2d91"
down_revision: Union[str, Sequence[str], None] = "e2a9ffce7300"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_activity",
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("last_document_activity_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("owner_user_id"),
    )


def downgrade() -> None:
    op.drop_table("workspace_activity")
