from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AIChatRequest(BaseModel):
    message: str
    context_key: str = "general"


class AIChatResponse(BaseModel):
    reply: str
    context_key: str
    tokens_used: Optional[int] = None
    stub: bool = False


class AIMemoryOut(BaseModel):
    id: int
    user_id: int
    context_key: str
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RequestWriterRequest(BaseModel):
    description: str


class RequestWriterResponse(BaseModel):
    title: str
    category: str
    description: str
    budget_min: int
    budget_max: int
    estimated_group_likelihood: str
    group_reason: str
    stub: bool = False


class BidDrafterRequest(BaseModel):
    request_id: int


class BidDrafterResponse(BaseModel):
    suggested_amount_cents: int
    suggested_days: int
    draft_text: str
    headline: str
    confidence: str
    stub: bool = False


class QuoteSummaryVsNeighBid(BaseModel):
    neighbid_best_bid: int
    saving_if_use_neighbid: int
    neighbid_has_warranty: bool


class QuoteSummaryResponse(BaseModel):
    provider_name: str
    quoted_amount: int
    scope_summary: str
    flags: list[str]
    vs_neighbid: Optional[QuoteSummaryVsNeighBid] = None
    score: int
    recommendation: str
    stub: bool = False


class SmartScheduleItem(BaseModel):
    title: str
    suggested_start: str
    duration_minutes: int
    address: Optional[str] = None
    neighborhood: str
    request_id: Optional[int] = None
    reason: str


class SmartScheduleResponse(BaseModel):
    date: str
    items: list[SmartScheduleItem]
    total_hours: float
    estimated_revenue_cents: int
    conflicts: list[str]
    stub: bool = False


class DisputeRequest(BaseModel):
    complaint: str


class DisputeResolutionOption(BaseModel):
    type: str
    description: str
    amount_cents: Optional[int] = None


class DisputeResponse(BaseModel):
    summary: str
    homeowner_position: str
    provider_position: str
    resolution_options: list[DisputeResolutionOption]
    recommendation: str
    confidence: str
    stub: bool = False


class DemandPrediction(BaseModel):
    category: str
    predicted_requests: int
    confidence: str
    reasoning: str
    provider_shortage: bool
    shortage_note: str


class DemandForecastResponse(BaseModel):
    neighborhood: str
    forecast_period: str
    predictions: list[DemandPrediction]
    top_opportunity: str
    stub: bool = False
