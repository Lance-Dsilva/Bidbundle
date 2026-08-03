from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db
from models.user import User
from schemas.user import UserOut

router = APIRouter(prefix="/users", tags=["users"])


class UserUpdate(BaseModel):
    full_name: str
    phone: str | None = None
    address: str | None = None
    neighborhood: str | None = None


@router.get("/me", response_model=UserOut)
def read_me(current_user: User = Depends(get_current_user)) -> UserOut:
    return current_user


@router.put("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    current_user.full_name = payload.full_name
    current_user.phone = payload.phone
    current_user.address = payload.address
    current_user.neighborhood = payload.neighborhood
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user
