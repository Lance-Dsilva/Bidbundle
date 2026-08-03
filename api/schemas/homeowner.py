from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class HomeownerProfileOut(BaseModel):
    id: int
    user_id: int
    service_radius_mi: int
    notif_bids: bool
    notif_groups: bool
    notif_savings: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class HomeownerProfileUpdate(BaseModel):
    notif_bids: Optional[bool] = None
    notif_groups: Optional[bool] = None
    notif_savings: Optional[bool] = None


class HomeownerDashboardOut(BaseModel):
    cold_start: bool
    active_requests: int
    active_bids: int
    total_saved_cents: int
    unread_messages: int


class HomeownerRequestOut(BaseModel):
    id: int
    title: str
    description: str
    category: str
    neighborhood: str
    status: str
    budget_min: int
    budget_max: int
    bid_count: int
    best_bid_cents: Optional[int]
    closes_at: Optional[datetime]
    created_at: datetime
    group_id: Optional[int] = None
    group_status: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class HomeownerBidOut(BaseModel):
    id: int
    request_id: int
    request_title: str
    provider_id: int
    provider_name: str
    amount: int
    estimated_days: int
    work_days: list[str] = []
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MessageOut(BaseModel):
    id: int
    sender_id: int
    sender_name: str
    conversation_id: Optional[int]
    channel_id: Optional[int]
    text: str
    read_at: Optional[datetime]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    text: str


class ConversationOut(BaseModel):
    id: int
    other_user_id: int
    other_user_name: str
    last_message: Optional[str]
    last_message_at: Optional[datetime]
    unread_count: int


class GroupChannelOut(BaseModel):
    id: int
    request_id: int
    request_title: str
    archived: bool = False
    expires_at: Optional[datetime] = None
    member_count: int
    last_message: Optional[str]
    last_message_at: Optional[datetime]
    unread_count: int
