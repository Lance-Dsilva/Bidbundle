from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class ProviderProfile(Base):
    __tablename__ = "provider_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    company_name: Mapped[str | None] = mapped_column(String, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    trades: Mapped[str] = mapped_column(String, nullable=False, default="")
    service_radius_mi: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    neighborhood: Mapped[str | None] = mapped_column(String, nullable=True)
    working_hours_start: Mapped[str] = mapped_column(String, nullable=False, default="07:00")
    working_hours_end: Mapped[str] = mapped_column(String, nullable=False, default="18:00")
    working_days: Mapped[str] = mapped_column(String, nullable=False, default="Mon,Tue,Wed,Thu,Fri,Sat")
    is_insured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_licensed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    license_number: Mapped[str | None] = mapped_column(String, nullable=True)
    bank_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
