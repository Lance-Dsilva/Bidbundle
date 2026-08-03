from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Conversation(Base):
    """1:1 DM channel between two users."""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="Message.conversation_id == Conversation.id",
        lazy="selectin",
        order_by="Message.created_at",
    )


class GroupChannel(Base):
    """Group chat scoped to one ServiceRequest."""

    __tablename__ = "group_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("service_requests.id"), unique=True, nullable=False
    )
    archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    members: Mapped[list["ChannelMember"]] = relationship("ChannelMember", lazy="selectin")
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="Message.channel_id == GroupChannel.id",
        lazy="selectin",
        order_by="Message.created_at",
    )


class ChannelMember(Base):
    __tablename__ = "channel_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("group_channels.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class Message(Base):
    """Unified message — belongs to either a Conversation (DM) or GroupChannel."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    conversation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("conversations.id"), nullable=True
    )
    channel_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("group_channels.id"), nullable=True
    )
    neighbourhood_channel_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("group_channels.id"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
