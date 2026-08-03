"""neighbourhood_messages_archive

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-05-07 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(
            sa.Column(
                "neighbourhood_channel_id",
                sa.Integer(),
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_messages_neighbourhood_channel_id_group_channels",
            "group_channels",
            ["neighbourhood_channel_id"],
            ["id"],
        )

    with op.batch_alter_table("group_channels") as batch_op:
        batch_op.add_column(
            sa.Column(
                "archived",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("group_channels") as batch_op:
        batch_op.drop_column("archived")

    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "fk_messages_neighbourhood_channel_id_group_channels",
            type_="foreignkey",
        )
        batch_op.drop_column("neighbourhood_channel_id")
