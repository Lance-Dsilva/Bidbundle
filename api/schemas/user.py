from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str | None = None
    role: Literal["homeowner", "provider", "admin", "hoa_homeowner"]
    latitude: float | None = None
    longitude: float | None = None


class UserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    phone: str | None = None
    role: Literal["homeowner", "provider", "admin", "hoa_homeowner"]
    neighborhood: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    neighbourhood_id: int | None = None
    community_id: int | None = None
    unit_number: str | None = None
    is_verified: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: int
    role: Literal["homeowner", "provider", "admin", "hoa_homeowner"]
