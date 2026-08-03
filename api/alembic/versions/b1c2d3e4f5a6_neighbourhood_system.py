"""neighbourhood_system

Revision ID: b1c2d3e4f5a6
Revises: a9e1b2c3d4f5
Create Date: 2026-05-07 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a9e1b2c3d4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "neighbourhoods" not in tables:
        op.create_table(
            "neighbourhoods",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("centroid_lat", sa.Float(), nullable=False),
            sa.Column("centroid_lng", sa.Float(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    if "neighbourhood_channels" not in tables:
        op.create_table(
            "neighbourhood_channels",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("neighbourhood_id", sa.Integer(), sa.ForeignKey("neighbourhoods.id"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("neighbourhood_id", name="uq_nc_neighbourhood"),
        )

    if "neighbourhood_channel_members" not in tables:
        op.create_table(
            "neighbourhood_channel_members",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("channel_id", sa.Integer(), sa.ForeignKey("neighbourhood_channels.id"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column(
                "joined_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("(CURRENT_TIMESTAMP)"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("channel_id", "user_id", name="uq_ncm_channel_user"),
        )

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "latitude" not in user_columns:
        op.add_column("users", sa.Column("latitude", sa.Float(), nullable=True))
    if "longitude" not in user_columns:
        op.add_column("users", sa.Column("longitude", sa.Float(), nullable=True))

    user_foreign_keys = {
        tuple(fk["constrained_columns"]): fk for fk in inspector.get_foreign_keys("users")
    }
    has_neighbourhood_fk = ("neighbourhood_id",) in user_foreign_keys

    if "neighbourhood_id" not in user_columns:
        with op.batch_alter_table("users", recreate="always") as batch_op:
            batch_op.add_column(
                sa.Column("neighbourhood_id", sa.Integer(), sa.ForeignKey("neighbourhoods.id"), nullable=True)
            )
    elif not has_neighbourhood_fk:
        with op.batch_alter_table("users", recreate="always") as batch_op:
            batch_op.create_foreign_key(
                "fk_users_neighbourhood_id_neighbourhoods",
                "neighbourhoods",
                ["neighbourhood_id"],
                ["id"],
            )


def downgrade() -> None:
    op.drop_column("users", "neighbourhood_id")
    op.drop_column("users", "longitude")
    op.drop_column("users", "latitude")
    op.drop_table("neighbourhood_channel_members")
    op.drop_table("neighbourhood_channels")
    op.drop_table("neighbourhoods")
