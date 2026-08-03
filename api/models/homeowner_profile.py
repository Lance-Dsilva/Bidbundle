from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class HomeownerProfile(Base):
    __tablename__ = "homeowner_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    service_radius_mi: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    notif_bids: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notif_groups: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notif_savings: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
