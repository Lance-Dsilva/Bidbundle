"""homeowner profiles

Revision ID: ab12cd34ef56
Revises: e1a4c9b8d712
Create Date: 2026-05-06 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ab12cd34ef56"
down_revision: Union[str, None] = "e1a4c9b8d712"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "homeowner_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), unique=True, nullable=False),
        sa.Column("service_radius_mi", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("notif_bids", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("notif_groups", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("notif_savings", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
    )


def downgrade() -> None:
    op.drop_table("homeowner_profiles")
