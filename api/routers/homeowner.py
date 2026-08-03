from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy import func
from sqlalchemy.orm import Session

from dependencies import get_db, require_role
from models.bid import Bid
from models.homeowner_profile import HomeownerProfile
from models.message import ChannelMember, Conversation, GroupChannel, Message
from models.notification import Notification
from models.request import ServiceRequest
from models.request_group import GroupMember, RequestGroup
from models.user import User
from schemas.homeowner import (
    ConversationOut,
    GroupChannelOut,
    HomeownerBidOut,
    HomeownerDashboardOut,
    HomeownerProfileOut,
    HomeownerProfileUpdate,
    HomeownerRequestOut,
    MessageCreate,
    MessageOut,
)

router = APIRouter(prefix="/homeowner", tags=["homeowner"])


def _get_or_create_profile(db: Session, user: User) -> HomeownerProfile:
    profile = db.query(HomeownerProfile).filter(HomeownerProfile.user_id == user.id).first()
    if profile is None:
        profile = HomeownerProfile(user_id=user.id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/me", response_model=HomeownerProfileOut)
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> HomeownerProfileOut:
    return _get_or_create_profile(db, current_user)


@router.patch("/me", response_model=HomeownerProfileOut)
def update_profile(
    payload: HomeownerProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> HomeownerProfileOut:
    profile = _get_or_create_profile(db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/dashboard", response_model=HomeownerDashboardOut)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> HomeownerDashboardOut:
    uid = current_user.id

    my_requests = db.query(ServiceRequest).filter(ServiceRequest.user_id == uid).all()
    active_statuses = {"draft", "grouping", "live"}
    active_requests = len([r for r in my_requests if r.status in active_statuses])

    my_req_ids = [r.id for r in my_requests if r.status == "live"]
    active_bids = (
        db.query(func.count(Bid.id))
        .filter(Bid.request_id.in_(my_req_ids), Bid.status == "pending")
        .scalar()
        or 0
    ) if my_req_ids else 0

    accepted_bids = (
        db.query(Bid, ServiceRequest)
        .join(ServiceRequest, Bid.request_id == ServiceRequest.id)
        .filter(ServiceRequest.user_id == uid, Bid.status == "accepted")
        .all()
    )
    total_saved_cents = sum(max(0, req.budget_min - bid.amount) for bid, req in accepted_bids)

    unread_dm = (
        db.query(func.count(Message.id))
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(
            (Conversation.user_a_id == uid) | (Conversation.user_b_id == uid),
            Message.sender_id != uid,
            Message.read_at.is_(None),
        )
        .scalar()
        or 0
    )
    unread_group = (
        db.query(func.count(Message.id))
        .join(GroupChannel, Message.channel_id == GroupChannel.id)
        .join(ChannelMember, ChannelMember.channel_id == GroupChannel.id)
        .filter(
            ChannelMember.user_id == uid,
            Message.sender_id != uid,
            Message.read_at.is_(None),
        )
        .scalar()
        or 0
    )

    cold_start = len(my_requests) == 0

    return HomeownerDashboardOut(
        cold_start=cold_start,
        active_requests=active_requests,
        active_bids=active_bids,
        total_saved_cents=total_saved_cents,
        unread_messages=unread_dm + unread_group,
    )


@router.get("/requests", response_model=list[HomeownerRequestOut])
def list_my_requests(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[HomeownerRequestOut]:
    query = db.query(ServiceRequest).filter(ServiceRequest.user_id == current_user.id)
    if status:
        query = query.filter(ServiceRequest.status == status)
    requests = query.order_by(ServiceRequest.created_at.desc()).all()

    result = []
    for req in requests:
        bid_count = db.query(func.count(Bid.id)).filter(Bid.request_id == req.id).scalar() or 0
        best_bid = (
            db.query(Bid)
            .filter(Bid.request_id == req.id, Bid.status == "pending")
            .order_by(Bid.amount)
            .first()
        )
        result.append(
            HomeownerRequestOut(
                id=req.id,
                title=req.title,
                description=req.description,
                category=req.category,
                neighborhood=req.neighborhood,
                status=req.status,
                budget_min=req.budget_min,
                budget_max=req.budget_max,
                bid_count=bid_count,
                best_bid_cents=best_bid.amount if best_bid else None,
                closes_at=req.closes_at,
                created_at=req.created_at,
                group_id=req.group_id,
                group_status=(
                    db.query(RequestGroup.status)
                    .filter(RequestGroup.id == req.group_id)
                    .scalar()
                    if req.group_id
                    else None
                ),
            )
        )
    return result


@router.get("/bids", response_model=list[HomeownerBidOut])
def list_my_bids(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[HomeownerBidOut]:
    rows = (
        db.query(Bid, ServiceRequest, User)
        .join(ServiceRequest, Bid.request_id == ServiceRequest.id)
        .join(User, Bid.provider_id == User.id)
        .filter(ServiceRequest.user_id == current_user.id)
        .order_by(Bid.created_at.desc())
        .all()
    )
    latest_by_provider_request: dict[tuple[int, int], HomeownerBidOut] = {}
    for bid, req, provider in rows:
        latest_by_provider_request[(provider.id, req.id)] = HomeownerBidOut(
            id=bid.id,
            request_id=req.id,
            request_title=req.title,
            provider_id=provider.id,
            provider_name=provider.full_name,
            amount=bid.amount,
            estimated_days=bid.estimated_days,
            work_days=bid.work_days,
            status=bid.status,
            created_at=bid.created_at,
        )
    return list(latest_by_provider_request.values())


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[ConversationOut]:
    uid = current_user.id
    convs = db.query(Conversation).filter(
        (Conversation.user_a_id == uid) | (Conversation.user_b_id == uid)
    ).all()
    result = []
    for conv in convs:
        other_id = conv.user_b_id if conv.user_a_id == uid else conv.user_a_id
        other = db.query(User).filter(User.id == other_id).first()
        last_msg = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        unread = (
            db.query(func.count(Message.id))
            .filter(
                Message.conversation_id == conv.id,
                Message.sender_id != uid,
                Message.read_at.is_(None),
            )
            .scalar()
            or 0
        )
        result.append(
            ConversationOut(
                id=conv.id,
                other_user_id=other_id,
                other_user_name=other.full_name if other else "Unknown",
                last_message=last_msg.text if last_msg else None,
                last_message_at=last_msg.created_at if last_msg else None,
                unread_count=unread,
            )
        )
    return result


@router.post(
    "/conversations",
    response_model=ConversationOut,
    status_code=http_status.HTTP_201_CREATED,
)
def get_or_create_conversation(
    other_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> ConversationOut:
    uid = current_user.id
    conv = db.query(Conversation).filter(
        ((Conversation.user_a_id == uid) & (Conversation.user_b_id == other_user_id))
        | ((Conversation.user_a_id == other_user_id) & (Conversation.user_b_id == uid))
    ).first()
    if not conv:
        conv = Conversation(user_a_id=uid, user_b_id=other_user_id)
        db.add(conv)
        db.commit()
        db.refresh(conv)
    other = db.query(User).filter(User.id == other_user_id).first()
    return ConversationOut(
        id=conv.id,
        other_user_id=other_user_id,
        other_user_name=other.full_name if other else "Unknown",
        last_message=None,
        last_message_at=None,
        unread_count=0,
    )


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
def get_dm_messages(
    conv_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[MessageOut]:
    uid = current_user.id
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv or (conv.user_a_id != uid and conv.user_b_id != uid):
        raise HTTPException(status_code=403, detail="Not a participant")
    db.query(Message).filter(
        Message.conversation_id == conv_id,
        Message.sender_id != uid,
        Message.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()})
    db.commit()
    msgs = db.query(Message).filter(Message.conversation_id == conv_id).order_by(Message.created_at).all()
    result = []
    for msg in msgs:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        result.append(
            MessageOut(
                id=msg.id,
                sender_id=msg.sender_id,
                sender_name=sender.full_name if sender else "Unknown",
                conversation_id=msg.conversation_id,
                channel_id=msg.channel_id,
                text=msg.text,
                read_at=msg.read_at,
                created_at=msg.created_at,
            )
        )
    return result


@router.post(
    "/conversations/{conv_id}/messages",
    response_model=MessageOut,
    status_code=http_status.HTTP_201_CREATED,
)
def send_dm(
    conv_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> MessageOut:
    uid = current_user.id
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv or (conv.user_a_id != uid and conv.user_b_id != uid):
        raise HTTPException(status_code=403, detail="Not a participant")
    msg = Message(sender_id=uid, conversation_id=conv_id, text=payload.text)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut(
        id=msg.id,
        sender_id=msg.sender_id,
        sender_name=current_user.full_name,
        conversation_id=msg.conversation_id,
        channel_id=msg.channel_id,
        text=msg.text,
        read_at=msg.read_at,
        created_at=msg.created_at,
    )


@router.get("/channels", response_model=list[GroupChannelOut])
def list_channels(
    archived: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[GroupChannelOut]:
    uid = current_user.id
    channels = (
        db.query(GroupChannel)
        .join(ChannelMember, ChannelMember.channel_id == GroupChannel.id)
        .filter(ChannelMember.user_id == uid)
        .all()
    )

    result = []
    for ch in channels:
        now = datetime.utcnow()
        if ch.expires_at and ch.expires_at <= now:
            if not ch.archived:
                ch.archived = True
                db.commit()
            continue
        req = db.query(ServiceRequest).filter(ServiceRequest.id == ch.request_id).first()
        if req and req.status == "closed" and ch.expires_at is None and not ch.archived:
            ch.archived = True
            db.commit()
            db.refresh(ch)
        if archived is not None and ch.archived != archived:
            continue
        last_msg = (
            db.query(Message)
            .filter(Message.channel_id == ch.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        member_count = (
            db.query(func.count(ChannelMember.id))
            .filter(ChannelMember.channel_id == ch.id)
            .scalar()
            or 0
        )
        unread = (
            db.query(func.count(Message.id))
            .filter(
                Message.channel_id == ch.id,
                Message.sender_id != uid,
                Message.read_at.is_(None),
            )
            .scalar()
            or 0
        )
        result.append(
            GroupChannelOut(
                id=ch.id,
                request_id=ch.request_id,
                request_title=req.title if req else "Unknown",
                archived=ch.archived,
                expires_at=ch.expires_at,
                member_count=member_count,
                last_message=last_msg.text if last_msg else None,
                last_message_at=last_msg.created_at if last_msg else None,
                unread_count=unread,
            )
        )
    return result


@router.get("/channels/{channel_id}/messages", response_model=list[MessageOut])
def list_channel_messages(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[MessageOut]:
    uid = current_user.id
    ch = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    is_member = db.query(ChannelMember).filter(
        ChannelMember.channel_id == channel_id,
        ChannelMember.user_id == uid,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a participant")
    db.query(Message).filter(
        Message.channel_id == channel_id,
        Message.sender_id != uid,
        Message.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()})
    db.commit()
    msgs = db.query(Message).filter(Message.channel_id == channel_id).order_by(Message.created_at).all()
    result = []
    for msg in msgs:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        result.append(
            MessageOut(
                id=msg.id,
                sender_id=msg.sender_id,
                sender_name=sender.full_name if sender else "Unknown",
                conversation_id=msg.conversation_id,
                channel_id=msg.channel_id,
                text=msg.text,
                read_at=msg.read_at,
                created_at=msg.created_at,
            )
        )
    return result


@router.post(
    "/channels/{channel_id}/messages",
    response_model=MessageOut,
    status_code=http_status.HTTP_201_CREATED,
)
def send_channel_message(
    channel_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> MessageOut:
    uid = current_user.id
    ch = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    is_member = db.query(ChannelMember).filter(
        ChannelMember.channel_id == channel_id,
        ChannelMember.user_id == uid,
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a participant")
    msg = Message(sender_id=uid, channel_id=channel_id, text=payload.text)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return MessageOut(
        id=msg.id,
        sender_id=msg.sender_id,
        sender_name=current_user.full_name,
        conversation_id=msg.conversation_id,
        channel_id=msg.channel_id,
        text=msg.text,
        read_at=msg.read_at,
        created_at=msg.created_at,
    )


@router.get("/groups")
def list_my_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> list[dict]:
    memberships = (
        db.query(GroupMember)
        .filter(
            GroupMember.user_id == current_user.id,
            GroupMember.approval_status != "cancelled",
        )
        .all()
    )
    now = datetime.utcnow()
    result = []
    for membership in memberships:
        group = db.query(RequestGroup).filter(RequestGroup.id == membership.group_id).first()
        if not group:
            continue
        active_members = [member for member in group.members if member.approval_status != "cancelled"]
        approved_count = sum(1 for member in active_members if member.approval_status == "approved")
        hours_remaining = max(0.0, (group.grouping_closes_at - now).total_seconds() / 3600)
        result.append(
            {
                "group_id": group.id,
                "category": group.category,
                "neighborhood": group.neighborhood,
                "status": group.status,
                "member_count": len(active_members),
                "approved_count": approved_count,
                "my_approval_status": membership.approval_status,
                "my_request_id": membership.request_id,
                "grouping_closes_at": group.grouping_closes_at.isoformat(),
                "hours_remaining": round(hours_remaining, 1),
                "created_at": group.created_at.isoformat(),
            }
        )
    return result


@router.post("/groups/{group_id}/approve")
def approve_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> dict:
    group = db.query(RequestGroup).filter(RequestGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    membership = (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
        )
        .first()
    )
    if not membership or membership.approval_status == "cancelled":
        raise HTTPException(status_code=403, detail="Not a member of this group")

    if group.status not in ("pending_approval", "grouping"):
        raise HTTPException(
            status_code=400,
            detail=f"Group is not awaiting approval (status={group.status})",
        )

    membership.approval_status = "approved"
    db.commit()
    db.refresh(group)

    active_members = [member for member in group.members if member.approval_status != "cancelled"]
    all_approved = all(member.approval_status == "approved" for member in active_members)

    if all_approved and active_members:
        group.status = "bidding"
        db.commit()
        for member in active_members:
            db.add(
                Notification(
                    user_id=member.user_id,
                    type="group_bidding",
                    title=f"Your {group.category} group is now live!",
                    body="All members approved - providers can now see your group and submit bids.",
                    action_url="/app/homeowner/bids",
                )
            )
        db.commit()
        return {
            "status": "bidding",
            "message": "All members approved - group is now live for providers",
        }

    return {"status": group.status, "message": "Approval recorded"}


@router.post("/groups/{group_id}/cancel")
def cancel_group_membership(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> dict:
    group = db.query(RequestGroup).filter(RequestGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    membership = (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
        )
        .first()
    )
    if not membership or membership.approval_status == "cancelled":
        raise HTTPException(status_code=403, detail="Not an active member of this group")

    if group.status in ("bidding", "closed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Cannot leave group in '{group.status}' status — providers are already reviewing it")

    membership.approval_status = "cancelled"
    db.commit()
    db.refresh(group)

    remaining = [member for member in group.members if member.approval_status != "cancelled"]
    if not remaining:
        group.status = "cancelled"
        db.commit()
        return {"status": "cancelled", "message": "Group cancelled"}

    # Check if all remaining members already approved — if so, flip to bidding
    all_approved = all(m.approval_status == "approved" for m in remaining)
    if all_approved and group.status not in ("bidding", "closed", "cancelled"):
        group.status = "bidding"
        db.commit()
        for member in remaining:
            db.add(
                Notification(
                    user_id=member.user_id,
                    type="group_bidding",
                    title=f"Your {group.category} group is now live!",
                    body="All members approved — providers can now see your group and submit bids.",
                    action_url="/app/homeowner/bids",
                )
            )
        db.commit()
        return {"status": "bidding", "message": "All remaining members approved — group is now live for providers"}

    for member in remaining:
        db.add(
            Notification(
                user_id=member.user_id,
                type="group_member_left",
                title=f"A neighbour left the {group.category} group",
                body=(
                    f"{current_user.full_name} cancelled their participation. "
                    "You can still proceed or cancel."
                ),
                action_url="/app/homeowner/bids",
            )
        )
    db.commit()
    return {"status": group.status, "message": "You have left the group"}
