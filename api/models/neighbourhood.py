from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Neighbourhood(Base):
    __tablename__ = "neighbourhoods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    centroid_lat: Mapped[float] = mapped_column(Float, nullable=False)
    centroid_lng: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class NeighbourhoodChannel(Base):
    __tablename__ = "neighbourhood_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    neighbourhood_id: Mapped[int] = mapped_column(
        ForeignKey("neighbourhoods.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    members: Mapped[list["NeighbourhoodChannelMember"]] = relationship(
        "NeighbourhoodChannelMember", lazy="selectin"
    )


class NeighbourhoodChannelMember(Base):
    __tablename__ = "neighbourhood_channel_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("neighbourhood_channels.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("channel_id", "user_id", name="uq_ncm_channel_user"),)
