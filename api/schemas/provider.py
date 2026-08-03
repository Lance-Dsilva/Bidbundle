from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ProviderProfileOut(BaseModel):
    id: int
    user_id: int
    company_name: Optional[str]
    bio: Optional[str]
    trades: str
    service_radius_mi: int
    address: Optional[str]
    neighborhood: Optional[str]
    working_hours_start: str
    working_hours_end: str
    working_days: str
    is_insured: bool
    is_licensed: bool
    license_number: Optional[str]
    bank_last4: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    bio: Optional[str] = None
    trades: Optional[str] = None
    service_radius_mi: Optional[int] = None
    address: Optional[str] = None
    neighborhood: Optional[str] = None
    working_hours_start: Optional[str] = None
    working_hours_end: Optional[str] = None
    working_days: Optional[str] = None
    is_insured: Optional[bool] = None
    is_licensed: Optional[bool] = None
    license_number: Optional[str] = None
    bank_last4: Optional[str] = None


class ProviderDashboardOut(BaseModel):
    cold_start: bool
    active_bids: int
    jobs_completed: int
    revenue_30d_cents: int
    revenue_total_cents: int
    win_rate_pct: Optional[float]
    avg_rating: Optional[float]
    reviews_count: int
    unread_messages: int


class ProviderBidOut(BaseModel):
    id: int
    request_id: int
    request_title: str
    request_category: str
    request_neighborhood: str
    request_status: str
    amount: int
    estimated_days: int
    work_days: list[str] = []
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JobFeedItemOut(BaseModel):
    id: int
    title: str
    category: str
    neighborhood: str
    distance_mi: Optional[float] = None
    status: str
    budget_min: int
    budget_max: int
    bid_count: int
    created_at: datetime
    closes_at: Optional[datetime]
    group_id: Optional[int] = None
    member_count: Optional[int] = None
    is_group: bool = False
    primary_request_id: Optional[int] = None  # lead ServiceRequest.id for bids/drafter

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

    model_config = ConfigDict(from_attributes=True)


class GroupChannelOut(BaseModel):
    id: int
    request_id: int
    request_title: str
    member_count: int
    last_message: Optional[str]
    last_message_at: Optional[datetime]
    unread_count: int

    model_config = ConfigDict(from_attributes=True)


class ScheduleItemOut(BaseModel):
    id: int
    provider_id: int
    request_id: Optional[int]
    title: str
    address: Optional[str]
    scheduled_at: datetime
    duration_minutes: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScheduleItemCreate(BaseModel):
    title: str
    address: Optional[str] = None
    request_id: Optional[int] = None
    scheduled_at: datetime
    duration_minutes: int = 60
    status: str = "scheduled"


class EarningsOut(BaseModel):
    total_cents: int
    pending_cents: int
    this_month_cents: int
    jobs_total: int
    jobs_this_month: int
    avg_job_value_cents: int


class ReviewOut(BaseModel):
    id: int
    homeowner_id: int
    homeowner_name: str
    bid_id: int
    stars: int
    comment: Optional[str]
    tag: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReviewCreate(BaseModel):
    bid_id: int
    stars: int
    comment: Optional[str] = None
    tag: Optional[str] = None
