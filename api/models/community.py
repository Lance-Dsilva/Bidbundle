from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class MembershipRequest(Base):
    __tablename__ = "membership_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    hoa_id: Mapped[int] = mapped_column(ForeignKey("hoas.id"))
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|approved|declined|revoked
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class HOA(Base):
    __tablename__ = "hoas"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    neighborhood: Mapped[str] = mapped_column(String)
    admin_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    unit_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    master_invite_code: Mapped[Optional[str]] = mapped_column(String, nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    members: Mapped[list["CommunityMember"]] = relationship(
        "CommunityMember",
        back_populates="hoa",
        lazy="selectin",
    )


class CommunityMember(Base):
    __tablename__ = "community_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    hoa_id: Mapped[int] = mapped_column(ForeignKey("hoas.id"))
    eligibility: Mapped[str] = mapped_column(String, default="pending")  # verified|pending|ineligible
    address: Mapped[str] = mapped_column(String)
    join_date: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    hoa: Mapped["HOA"] = relationship("HOA", back_populates="members")


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    hoa_id: Mapped[int] = mapped_column(ForeignKey("hoas.id"))
    description: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)  # bid|join|saving
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    hoa_id: Mapped[int] = mapped_column(ForeignKey("hoas.id"))
    email: Mapped[str] = mapped_column(String)
    code: Mapped[str] = mapped_column(String, unique=True, index=True)
    unit_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|accepted|expired
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=False))
