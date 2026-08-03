from datetime import datetime

from pydantic import BaseModel, ConfigDict

from schemas.bid import BidOut


class ServiceRequestCreate(BaseModel):
    title: str
    description: str
    category: str
    neighborhood: str
    status: str = "draft"
    budget_min: int
    budget_max: int
    group_id: int | None = None


class ServiceRequestOut(BaseModel):
    id: int
    user_id: int
    title: str
    description: str
    category: str
    neighborhood: str
    status: str
    budget_min: int
    budget_max: int
    created_at: datetime
    closes_at: datetime | None
    bids: list[BidOut] = []
    matched_group_id: int | None = None
    group_id: int | None = None
    group_status: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ServiceRequestList(BaseModel):
    id: int
    title: str
    category: str
    neighborhood: str
    status: str
    budget_min: int
    budget_max: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
