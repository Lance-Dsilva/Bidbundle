from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class RequestGroup(Base):
    """
    A time-boxed group of homeowners with the same service need in the same area.
    Status flow: grouping -> pending_approval -> bidding -> closed | cancelled
    Providers only see groups in 'bidding' status.
    """

    __tablename__ = "request_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    neighbourhood_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("neighbourhoods.id"), nullable=True
    )
    neighborhood: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="grouping")
    grouping_closes_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    members: Mapped[list["GroupMember"]] = relationship(
        "GroupMember", back_populates="group", lazy="selectin"
    )


class GroupMember(Base):
    """One homeowner's participation in a RequestGroup."""

    __tablename__ = "group_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("request_groups.id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("service_requests.id"), nullable=False
    )
    approval_status: Mapped[str] = mapped_column(
        String, nullable=False, default="pending"
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    group: Mapped["RequestGroup"] = relationship(
        "RequestGroup", back_populates="members"
    )
