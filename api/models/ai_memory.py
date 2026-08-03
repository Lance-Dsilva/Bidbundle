from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AIMemory(Base):
    """
    Stores per-user AI conversation history.
    context_key scopes the memory:
      - "general"            -> personal AI assistant
      - "group:{channel_id}" -> group bid channel
    role is "user" | "assistant" | "system"
    """

    __tablename__ = "ai_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    context_key: Mapped[str] = mapped_column(String, nullable=False, default="general")
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
