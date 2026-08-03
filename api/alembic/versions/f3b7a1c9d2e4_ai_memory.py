"""ai memory

Revision ID: f3b7a1c9d2e4
Revises: ab12cd34ef56
Create Date: 2026-05-07 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3b7a1c9d2e4"
down_revision: Union[str, None] = "ab12cd34ef56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_memory",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("context_key", sa.String(), nullable=False, server_default="general"),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
    )
    op.create_index(
        "ix_ai_memory_user_context",
        "ai_memory",
        ["user_id", "context_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_memory_user_context", table_name="ai_memory")
    op.drop_table("ai_memory")
