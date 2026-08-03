from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CommunityMemberOut(BaseModel):
    id: int
    user_id: int
    hoa_id: int
    eligibility: str
    address: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HOAOut(BaseModel):
    id: int
    name: str
    neighborhood: str
    admin_user_id: int
    type: str | None = None
    unit_count: int | None = None
    master_invite_code: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityLogOut(BaseModel):
    id: int
    hoa_id: int
    description: str
    type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SavingsCategoryOut(BaseModel):
    name: str
    saved: int
    bids: int


class SavingsReportOut(BaseModel):
    categories: list[SavingsCategoryOut]
    total: int


class AdminStatsOut(BaseModel):
    total_members: int
    active_bids: int
    monthly_savings: int
    total_savings_all_time: int


class InviteOut(BaseModel):
    id: int
    hoa_id: int
    email: str
    code: str
    unit_number: str | None
    status: str
    created_at: datetime
    expires_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InviteCreate(BaseModel):
    email: str
    unit_number: str | None = None


class ValidateInviteOut(BaseModel):
    community_name: str
    community_type: str | None
    unit_number: str | None
    invite_id: int | None = None


class HoaMemberOut(BaseModel):
    user_id: int
    full_name: str
    email: str
    unit_number: str | None
    eligibility: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HoaStatsOut(BaseModel):
    community_name: str
    community_type: str | None
    total_members: int
    active_requests: int
    total_savings: int
    master_invite_code: str | None


class MembershipRequestOut(BaseModel):
    id: int
    user_id: int
    hoa_id: int
    status: str
    note: str | None
    created_at: datetime
    reviewed_at: datetime | None
    full_name: str
    email: str
    unit_number: str | None

    model_config = ConfigDict(from_attributes=True)


class MyStatusOut(BaseModel):
    status: str  # pending|approved|declined|revoked|none
    hoa_name: str | None = None
    hoa_id: int | None = None
    request_id: int | None = None
