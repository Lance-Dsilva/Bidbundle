from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ServiceRequest(Base):
    __tablename__ = "service_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("request_groups.id"), nullable=True, default=None
    )
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    neighborhood: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="draft")  # draft|grouping|live|closed
    budget_min: Mapped[int] = mapped_column(Integer)
    budget_max: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    closes_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False), nullable=True)
    bids: Mapped[list["Bid"]] = relationship("Bid", back_populates="request", lazy="selectin")
