"""request groups and group members

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-08
"""

from alembic import op
import sqlalchemy as sa


revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "request_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column(
            "neighbourhood_id",
            sa.Integer(),
            sa.ForeignKey("neighbourhoods.id"),
            nullable=True,
        ),
        sa.Column("neighborhood", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="grouping"),
        sa.Column("grouping_closes_at", sa.DateTime(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
    )
    op.create_table(
        "group_members",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "group_id", sa.Integer(), sa.ForeignKey("request_groups.id"), nullable=False
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "request_id",
            sa.Integer(),
            sa.ForeignKey("service_requests.id"),
            nullable=False,
        ),
        sa.Column("approval_status", sa.String(), nullable=False, server_default="pending"),
        sa.Column(
            "joined_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    with op.batch_alter_table("service_requests") as batch_op:
        batch_op.add_column(sa.Column("group_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_service_requests_group_id_request_groups",
            "request_groups",
            ["group_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("service_requests") as batch_op:
        batch_op.drop_constraint(
            "fk_service_requests_group_id_request_groups",
            type_="foreignkey",
        )
        batch_op.drop_column("group_id")
    op.drop_table("group_members")
    op.drop_table("request_groups")
