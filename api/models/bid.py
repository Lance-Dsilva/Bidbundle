from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("service_requests.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    amount: Mapped[int] = mapped_column(Integer)
    estimated_days: Mapped[int] = mapped_column(Integer)
    work_days_csv: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|accepted|declined
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now())
    request: Mapped["ServiceRequest"] = relationship("ServiceRequest", back_populates="bids")

    @property
    def work_days(self) -> list[str]:
        return [part for part in (self.work_days_csv or "").split(",") if part]

    @work_days.setter
    def work_days(self, values: list[str]) -> None:
        self.work_days_csv = ",".join(values)
