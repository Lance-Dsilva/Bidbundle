from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db
from models.neighbourhood import Neighbourhood, NeighbourhoodChannel, NeighbourhoodChannelMember
from models.message import Message
from models.request import ServiceRequest
from models.request_group import GroupMember, RequestGroup
from models.bid import Bid
from models.user import User

router = APIRouter(prefix="/neighbourhood", tags=["neighbourhood"])


class NeighbourhoodChannelOut(BaseModel):
    id: int
    neighbourhood_id: int
    neighbourhood_name: str
    member_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NeighbourhoodMemberOut(BaseModel):
    user_id: int
    full_name: str
    joined_at: datetime


class GroupChannelMessageOut(BaseModel):
    id: int
    sender_id: int
    sender_name: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GroupChannelMessageIn(BaseModel):
    content: str


@router.get("/channel", response_model=Optional[NeighbourhoodChannelOut])
def get_my_neighbourhood_channel(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Optional[dict]:
    """Return the general neighbourhood channel for the current user, or null."""
    if not current_user.neighbourhood_id:
        return None
    channel = db.query(NeighbourhoodChannel).filter(
        NeighbourhoodChannel.neighbourhood_id == current_user.neighbourhood_id
    ).first()
    if not channel:
        return None
    neighbourhood = db.query(Neighbourhood).filter(
        Neighbourhood.id == current_user.neighbourhood_id
    ).first()
    return {
        "id": channel.id,
        "neighbourhood_id": channel.neighbourhood_id,
        "neighbourhood_name": neighbourhood.name if neighbourhood else "My Neighbourhood",
        "member_count": len(channel.members),
        "created_at": channel.created_at,
    }


@router.get("/channel/members", response_model=list[NeighbourhoodMemberOut])
def get_neighbourhood_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return all members of the user's neighbourhood channel."""
    if not current_user.neighbourhood_id:
        return []
    channel = db.query(NeighbourhoodChannel).filter(
        NeighbourhoodChannel.neighbourhood_id == current_user.neighbourhood_id
    ).first()
    if not channel:
        return []
    result = []
    for m in channel.members:
        u = db.query(User).filter(User.id == m.user_id).first()
        if u:
            result.append({"user_id": u.id, "full_name": u.full_name, "joined_at": m.joined_at})
    return result


@router.get("/channel/{channel_id}/messages", response_model=list[GroupChannelMessageOut])
def get_neighbourhood_channel_messages(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Get messages for a neighbourhood general channel."""
    channel = db.query(NeighbourhoodChannel).filter(NeighbourhoodChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Neighbourhood channel not found")

    is_member = db.query(NeighbourhoodChannelMember).filter(
        NeighbourhoodChannelMember.channel_id == channel_id,
        NeighbourhoodChannelMember.user_id == current_user.id,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a channel member")

    messages = (
        db.query(Message)
        .filter(Message.neighbourhood_channel_id == channel_id)
        .order_by(Message.created_at)
        .limit(50)
        .all()
    )
    result = []
    for msg in messages:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        result.append({
            "id": msg.id,
            "sender_id": msg.sender_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "content": msg.text,
            "created_at": msg.created_at,
        })
    return result


@router.post("/channel/{channel_id}/messages", response_model=GroupChannelMessageOut, status_code=201)
def send_neighbourhood_channel_message(
    channel_id: int,
    payload: GroupChannelMessageIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Send a message to a neighbourhood general channel."""
    channel = db.query(NeighbourhoodChannel).filter(NeighbourhoodChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Neighbourhood channel not found")

    is_member = db.query(NeighbourhoodChannelMember).filter(
        NeighbourhoodChannelMember.channel_id == channel_id,
        NeighbourhoodChannelMember.user_id == current_user.id,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a channel member")

    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    msg = Message(
        sender_id=current_user.id,
        neighbourhood_channel_id=channel_id,
        text=text,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return {
        "id": msg.id,
        "sender_id": msg.sender_id,
        "sender_name": current_user.full_name,
        "content": msg.text,
        "created_at": msg.created_at,
    }


class NeighbourhoodRequestOut(BaseModel):
    id: int
    title: str
    category: str
    neighborhood: str
    status: str
    budget_min: int
    budget_max: int
    bid_count: int
    owner_name: str
    is_mine: bool
    group_id: Optional[int] = None
    group_status: Optional[str] = None  # grouping | pending_approval | bidding | closed


@router.get("/requests", response_model=list[NeighbourhoodRequestOut])
def get_neighbourhood_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """
    Return active neighbourhood demand in the user's area.
    Includes grouped requests that are still collecting neighbours, awaiting approval,
    or actively bidding, plus solo live/grouping requests.

    If the user has a neighbourhood_id (assigned by lat/lng on signup), filter by
    all homeowners in the same geo-cluster regardless of what neighborhood string
    they typed in their request.  Falls back to string-name matching for legacy users.
    """
    query = db.query(ServiceRequest)

    if current_user.neighbourhood_id:
        # All users in the same geo-cluster
        cluster_user_ids = [
            u.id for u in db.query(User).filter(
                User.neighbourhood_id == current_user.neighbourhood_id
            ).all()
        ]
        query = query.filter(ServiceRequest.user_id.in_(cluster_user_ids))
    elif current_user.neighborhood:
        # Legacy fallback: match the free-text neighborhood string
        query = query.filter(ServiceRequest.neighborhood == current_user.neighborhood)

    requests = query.order_by(ServiceRequest.created_at.desc()).limit(50).all()

    # Get groups the current user is already a member of
    my_group_ids = {
        m.group_id for m in db.query(GroupMember).filter(
            GroupMember.user_id == current_user.id,
            GroupMember.approval_status != "cancelled",
        ).all()
    }

    active_group_statuses = {"grouping", "pending_approval", "bidding"}
    result = []
    seen_group_ids: set = set()

    for req in requests:
        # Look up the group this request belongs to
        group = None
        if req.group_id:
            group = db.query(RequestGroup).filter(RequestGroup.id == req.group_id).first()

        group_status = group.status if group else None
        is_active_group_request = group_status in active_group_statuses
        is_active_solo_request = req.group_id is None and req.status in {"live", "grouping"}

        if not is_active_group_request and not is_active_solo_request:
            continue

        # Only show one entry per group (deduplicate)
        if req.group_id and req.group_id in seen_group_ids:
            continue
        if req.group_id:
            seen_group_ids.add(req.group_id)

        if req.group_id:
            group_request_ids = [
                member.request_id
                for member in db.query(GroupMember).filter(
                    GroupMember.group_id == req.group_id,
                    GroupMember.approval_status != "cancelled",
                ).all()
            ]
            bid_count = (
                db.query(Bid)
                .filter(Bid.request_id.in_(group_request_ids))
                .count()
                if group_request_ids
                else 0
            )
        else:
            bid_count = db.query(Bid).filter(Bid.request_id == req.id).count()
        owner = db.query(User).filter(User.id == req.user_id).first()
        result.append({
            "id": req.id,
            "title": req.title,
            "category": req.category,
            "neighborhood": req.neighborhood,
            "status": req.status,
            "budget_min": req.budget_min,
            "budget_max": req.budget_max,
            "bid_count": bid_count,
            "owner_name": owner.full_name if owner else "A neighbour",
            "is_mine": req.user_id == current_user.id or (req.group_id in my_group_ids),
            "group_id": req.group_id,
            "group_status": group_status,
        })
    return result
