from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BidCreate(BaseModel):
    amount: int
    estimated_days: int
    work_days: list[str] = []


class BidOut(BaseModel):
    id: int
    request_id: int
    provider_id: int
    amount: int
    estimated_days: int
    work_days: list[str] = []
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
