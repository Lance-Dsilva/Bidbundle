from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from dependencies import get_db, require_role
from models.bid import Bid
from models.message import ChannelMember, Conversation, GroupChannel, Message
from models.neighbourhood import Neighbourhood
from models.provider_profile import ProviderProfile
from models.request import ServiceRequest
from models.request_group import RequestGroup
from models.review import Review
from models.schedule_item import ScheduleItem
from models.user import User
from schemas.provider import (
    ConversationOut,
    EarningsOut,
    GroupChannelOut,
    JobFeedItemOut,
    MessageCreate,
    MessageOut,
    ProviderBidOut,
    ProviderDashboardOut,
    ProviderProfileOut,
    ProviderProfileUpdate,
    ReviewCreate,
    ReviewOut,
    ScheduleItemCreate,
    ScheduleItemOut,
)

router = APIRouter(prefix="/provider", tags=["provider"])


def _distance_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_mi = 3958.8
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    c = 2 * asin(sqrt(a))
    return earth_radius_mi * c


def _fallback_work_days(count: int) -> list[str]:
    days: list[str] = []
    cursor = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    while len(days) < max(count, 1):
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            days.append(cursor.date().isoformat())
    return days


def _reconcile_pending_bid_holds(db: Session, current_user: User) -> None:
    pending_bids = db.query(Bid).filter(
        Bid.provider_id == current_user.id,
        Bid.status == "pending",
    ).all()

    pending_request_ids = {bid.request_id for bid in pending_bids}
    blocked_holds = db.query(ScheduleItem).filter(
        ScheduleItem.provider_id == current_user.id,
        ScheduleItem.status == "blocked",
        ScheduleItem.request_id.is_not(None),
    ).all()

    for hold in blocked_holds:
        if hold.request_id not in pending_request_ids:
            db.delete(hold)

    for bid in pending_bids:
        request = db.query(ServiceRequest).filter(ServiceRequest.id == bid.request_id).first()
        if request is None:
            continue
        work_days = bid.work_days or _fallback_work_days(bid.estimated_days)
        existing = db.query(ScheduleItem).filter(
            ScheduleItem.provider_id == current_user.id,
            ScheduleItem.request_id == bid.request_id,
            ScheduleItem.status == "blocked",
        ).order_by(ScheduleItem.scheduled_at).all()

        expected_dates = [datetime.fromisoformat(f"{value}T09:00:00") for value in work_days]
        existing_dates = [item.scheduled_at.replace(hour=9, minute=0, second=0, microsecond=0) for item in existing]

        if len(existing) == len(expected_dates) and all(a == b for a, b in zip(existing_dates, expected_dates)):
            continue

        for item in existing:
            db.delete(item)

        for hold_at in expected_dates:
            db.add(
                ScheduleItem(
                    provider_id=current_user.id,
                    request_id=bid.request_id,
                    title=f"Temporary hold — {request.title}",
                    address=request.neighborhood,
                    scheduled_at=hold_at,
                    duration_minutes=8 * 60,
                    status="blocked",
                )
            )

    db.commit()


def _get_or_create_profile(db: Session, user: User) -> ProviderProfile:
    profile = db.query(ProviderProfile).filter(ProviderProfile.user_id == user.id).first()
    if profile is None:
        profile = ProviderProfile(user_id=user.id)
        db.add(profile)
        try:
            db.commit()
        except IntegrityError:
            # Concurrent request created it first — use that row.
            db.rollback()
            profile = db.query(ProviderProfile).filter(ProviderProfile.user_id == user.id).first()
            if profile is None:
                raise
            return profile
        db.refresh(profile)
    return profile


@router.get("/me", response_model=ProviderProfileOut)
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ProviderProfileOut:
    return _get_or_create_profile(db, current_user)


@router.patch("/me", response_model=ProviderProfileOut)
def update_profile(
    payload: ProviderProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ProviderProfileOut:
    profile = _get_or_create_profile(db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/dashboard", response_model=ProviderDashboardOut)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ProviderDashboardOut:
    provider_id = current_user.id

    all_bids = db.query(Bid).filter(Bid.provider_id == provider_id).all()
    total_bids = len(all_bids)
    accepted = [bid for bid in all_bids if bid.status == "accepted"]
    active = [bid for bid in all_bids if bid.status == "pending"]

    jobs_completed = len(accepted)
    active_bids = len(active)
    revenue_total_cents = sum(bid.amount for bid in accepted)

    cutoff_30d = datetime.utcnow() - timedelta(days=30)
    revenue_30d_cents = sum(bid.amount for bid in accepted if bid.created_at >= cutoff_30d)

    win_rate_pct = round(jobs_completed / total_bids * 100, 1) if total_bids > 0 else None

    reviews = db.query(Review).filter(Review.provider_id == provider_id).all()
    reviews_count = len(reviews)
    avg_rating = (
        round(sum(review.stars for review in reviews) / reviews_count, 1)
        if reviews_count > 0
        else None
    )

    unread_dm = (
        db.query(func.count(Message.id))
        .join(Conversation, Message.conversation_id == Conversation.id)
        .filter(
            ((Conversation.user_a_id == provider_id) | (Conversation.user_b_id == provider_id)),
            Message.sender_id != provider_id,
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
            ChannelMember.user_id == provider_id,
            Message.sender_id != provider_id,
            Message.read_at.is_(None),
        )
        .scalar()
        or 0
    )

    cold_start = jobs_completed == 0 and active_bids == 0

    return ProviderDashboardOut(
        cold_start=cold_start,
        active_bids=active_bids,
        jobs_completed=jobs_completed,
        revenue_30d_cents=revenue_30d_cents,
        revenue_total_cents=revenue_total_cents,
        win_rate_pct=win_rate_pct,
        avg_rating=avg_rating,
        reviews_count=reviews_count,
        unread_messages=unread_dm + unread_group,
    )


@router.get("/bids", response_model=list[ProviderBidOut])
def list_my_bids(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[ProviderBidOut]:
    query = (
        db.query(Bid, ServiceRequest)
        .join(ServiceRequest, Bid.request_id == ServiceRequest.id)
        .filter(Bid.provider_id == current_user.id)
    )
    if status:
        query = query.filter(Bid.status == status)
    rows = query.order_by(Bid.created_at.desc()).all()

    latest_by_request: dict[int, ProviderBidOut] = {}
    for bid, request in rows:
        latest_by_request[request.id] = ProviderBidOut(
            id=bid.id,
            request_id=request.id,
            request_title=request.title,
            request_category=request.category,
            request_neighborhood=request.neighborhood,
            request_status=request.status,
            amount=bid.amount,
            estimated_days=bid.estimated_days,
            work_days=bid.work_days,
            status=bid.status,
            created_at=bid.created_at,
        )
    return list(latest_by_request.values())


@router.get("/job-feed", response_model=list[JobFeedItemOut])
def job_feed(
    category: Optional[str] = Query(None),
    neighborhood: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[JobFeedItemOut]:
    profile = _get_or_create_profile(db, current_user)
    service_radius_mi = profile.service_radius_mi or 4

    group_query = db.query(RequestGroup).filter(RequestGroup.status == "bidding")
    if category:
        group_query = group_query.filter(RequestGroup.category == category)
    if neighborhood:
        group_query = group_query.filter(RequestGroup.neighborhood == neighborhood)

    groups = group_query.order_by(RequestGroup.created_at.desc()).all()
    result: list[JobFeedItemOut] = []

    for group in groups:
        active_members = [
            member for member in group.members if member.approval_status != "cancelled"
        ]
        if not active_members:
            continue

        member_request_ids = [member.request_id for member in active_members]
        member_requests = (
            db.query(ServiceRequest)
            .filter(ServiceRequest.id.in_(member_request_ids))
            .all()
        )
        if not member_requests:
            continue

        member_requests_by_id = {request.id: request for request in member_requests}
        ordered_requests = [
            member_requests_by_id[member.request_id]
            for member in active_members
            if member.request_id in member_requests_by_id
        ]
        if not ordered_requests:
            continue

        combined_budget_min = sum(request.budget_min for request in ordered_requests)
        combined_budget_max = sum(request.budget_max for request in ordered_requests)

        rep_title = ordered_requests[0].title

        bid_count = (
            db.query(func.count(Bid.id))
            .filter(Bid.request_id.in_([request.id for request in ordered_requests]))
            .scalar()
            or 0
        )

        distance_mi = None
        if (
            current_user.latitude is not None
            and current_user.longitude is not None
            and group.neighbourhood_id is not None
        ):
            neighbourhood_model = (
                db.query(Neighbourhood)
                .filter(Neighbourhood.id == group.neighbourhood_id)
                .first()
            )
            if neighbourhood_model is not None:
                distance_mi = round(
                    _distance_mi(
                        current_user.latitude,
                        current_user.longitude,
                        neighbourhood_model.centroid_lat,
                        neighbourhood_model.centroid_lng,
                    ),
                    1,
                )
                if distance_mi > service_radius_mi:
                    continue

        result.append(
            JobFeedItemOut(
                id=ordered_requests[0].id,
                title=rep_title,
                category=group.category,
                neighborhood=group.neighborhood,
                distance_mi=distance_mi,
                status=group.status,
                budget_min=combined_budget_min,
                budget_max=combined_budget_max,
                bid_count=bid_count,
                created_at=group.created_at,
                closes_at=None,
                group_id=group.id,
                member_count=len(active_members),
                is_group=True,
                primary_request_id=ordered_requests[0].id,
            )
        )

    result.sort(
        key=lambda item: (
            item.distance_mi is None,
            item.distance_mi if item.distance_mi is not None else float("inf"),
            -item.bid_count,
            -item.created_at.timestamp(),
        )
    )
    return result


@router.get("/schedule", response_model=list[ScheduleItemOut])
def list_schedule(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[ScheduleItemOut]:
    _reconcile_pending_bid_holds(db, current_user)
    query = db.query(ScheduleItem).filter(ScheduleItem.provider_id == current_user.id)
    if date_from:
        query = query.filter(ScheduleItem.scheduled_at >= date_from)
    if date_to:
        query = query.filter(ScheduleItem.scheduled_at <= date_to)
    return query.order_by(ScheduleItem.scheduled_at).all()


@router.post("/schedule", response_model=ScheduleItemOut, status_code=http_status.HTTP_201_CREATED)
def create_schedule_item(
    payload: ScheduleItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ScheduleItemOut:
    item = ScheduleItem(provider_id=current_user.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/schedule/{item_id}", response_model=ScheduleItemOut)
def update_schedule_item(
    item_id: int,
    status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ScheduleItemOut:
    item = (
        db.query(ScheduleItem)
        .filter(ScheduleItem.id == item_id, ScheduleItem.provider_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    item.status = status
    db.commit()
    db.refresh(item)
    return item


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[ConversationOut]:
    conversations = db.query(Conversation).filter(
        (Conversation.user_a_id == current_user.id) | (Conversation.user_b_id == current_user.id)
    ).all()

    result = []
    for conversation in conversations:
        other_id = (
            conversation.user_b_id
            if conversation.user_a_id == current_user.id
            else conversation.user_a_id
        )
        other = db.query(User).filter(User.id == other_id).first()
        last_message = (
            db.query(Message)
            .filter(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        unread = (
            db.query(func.count(Message.id))
            .filter(
                Message.conversation_id == conversation.id,
                Message.sender_id != current_user.id,
                Message.read_at.is_(None),
            )
            .scalar()
            or 0
        )
        result.append(
            ConversationOut(
                id=conversation.id,
                other_user_id=other_id,
                other_user_name=other.full_name if other else "Unknown",
                last_message=last_message.text if last_message else None,
                last_message_at=last_message.created_at if last_message else None,
                unread_count=unread,
            )
        )
    return result


@router.post("/conversations", response_model=ConversationOut, status_code=http_status.HTTP_201_CREATED)
def get_or_create_conversation(
    other_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> ConversationOut:
    conversation = db.query(Conversation).filter(
        ((Conversation.user_a_id == current_user.id) & (Conversation.user_b_id == other_user_id))
        | ((Conversation.user_a_id == other_user_id) & (Conversation.user_b_id == current_user.id))
    ).first()
    if not conversation:
        conversation = Conversation(user_a_id=current_user.id, user_b_id=other_user_id)
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
    other = db.query(User).filter(User.id == other_user_id).first()
    return ConversationOut(
        id=conversation.id,
        other_user_id=other_user_id,
        other_user_name=other.full_name if other else "Unknown",
        last_message=None,
        last_message_at=None,
        unread_count=0,
    )


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageOut])
def list_dm_messages(
    conv_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[MessageOut]:
    conversation = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conversation or (
        conversation.user_a_id != current_user.id and conversation.user_b_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="Not a participant")

    db.query(Message).filter(
        Message.conversation_id == conv_id,
        Message.sender_id != current_user.id,
        Message.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()})
    db.commit()

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
        .all()
    )
    result = []
    for message in messages:
        sender = db.query(User).filter(User.id == message.sender_id).first()
        result.append(
            MessageOut(
                id=message.id,
                sender_id=message.sender_id,
                sender_name=sender.full_name if sender else "Unknown",
                conversation_id=message.conversation_id,
                channel_id=message.channel_id,
                text=message.text,
                read_at=message.read_at,
                created_at=message.created_at,
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
    current_user: User = Depends(require_role("provider")),
) -> MessageOut:
    conversation = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conversation or (
        conversation.user_a_id != current_user.id and conversation.user_b_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="Not a participant")
    message = Message(sender_id=current_user.id, conversation_id=conv_id, text=payload.text)
    db.add(message)
    db.commit()
    db.refresh(message)
    return MessageOut(
        id=message.id,
        sender_id=message.sender_id,
        sender_name=current_user.full_name,
        conversation_id=message.conversation_id,
        channel_id=message.channel_id,
        text=message.text,
        read_at=message.read_at,
        created_at=message.created_at,
    )


@router.get("/channels", response_model=list[GroupChannelOut])
def list_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[GroupChannelOut]:
    bid_request_ids = [bid.request_id for bid in db.query(Bid).filter(Bid.provider_id == current_user.id).all()]
    channels = db.query(GroupChannel).filter(GroupChannel.request_id.in_(bid_request_ids)).all()
    result = []
    for channel in channels:
        request = db.query(ServiceRequest).filter(ServiceRequest.id == channel.request_id).first()
        last_message = (
            db.query(Message)
            .filter(Message.channel_id == channel.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        member_count = (
            db.query(func.count(ChannelMember.id))
            .filter(ChannelMember.channel_id == channel.id)
            .scalar()
            or 0
        )
        unread = (
            db.query(func.count(Message.id))
            .filter(
                Message.channel_id == channel.id,
                Message.sender_id != current_user.id,
                Message.read_at.is_(None),
            )
            .scalar()
            or 0
        )
        result.append(
            GroupChannelOut(
                id=channel.id,
                request_id=channel.request_id,
                request_title=request.title if request else "Unknown",
                member_count=member_count,
                last_message=last_message.text if last_message else None,
                last_message_at=last_message.created_at if last_message else None,
                unread_count=unread,
            )
        )
    return result


@router.get("/channels/{channel_id}/messages", response_model=list[MessageOut])
def list_channel_messages(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[MessageOut]:
    channel = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    bid = db.query(Bid).filter(
        Bid.request_id == channel.request_id, Bid.provider_id == current_user.id
    ).first()
    if not bid:
        raise HTTPException(status_code=403, detail="Not a participant")

    db.query(Message).filter(
        Message.channel_id == channel_id,
        Message.sender_id != current_user.id,
        Message.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()})
    db.commit()

    messages = (
        db.query(Message).filter(Message.channel_id == channel_id).order_by(Message.created_at).all()
    )
    result = []
    for message in messages:
        sender = db.query(User).filter(User.id == message.sender_id).first()
        result.append(
            MessageOut(
                id=message.id,
                sender_id=message.sender_id,
                sender_name=sender.full_name if sender else "Unknown",
                conversation_id=message.conversation_id,
                channel_id=message.channel_id,
                text=message.text,
                read_at=message.read_at,
                created_at=message.created_at,
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
    current_user: User = Depends(require_role("provider")),
) -> MessageOut:
    channel = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    bid = db.query(Bid).filter(
        Bid.request_id == channel.request_id, Bid.provider_id == current_user.id
    ).first()
    if not bid:
        raise HTTPException(status_code=403, detail="Not a participant")
    message = Message(sender_id=current_user.id, channel_id=channel_id, text=payload.text)
    db.add(message)
    db.commit()
    db.refresh(message)
    return MessageOut(
        id=message.id,
        sender_id=message.sender_id,
        sender_name=current_user.full_name,
        conversation_id=message.conversation_id,
        channel_id=message.channel_id,
        text=message.text,
        read_at=message.read_at,
        created_at=message.created_at,
    )


@router.get("/earnings", response_model=EarningsOut)
def get_earnings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> EarningsOut:
    all_accepted = db.query(Bid).filter(
        Bid.provider_id == current_user.id, Bid.status == "accepted"
    ).all()

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_cents = sum(bid.amount for bid in all_accepted)
    this_month_cents = sum(bid.amount for bid in all_accepted if bid.created_at >= month_start)
    jobs_total = len(all_accepted)
    jobs_this_month = len([bid for bid in all_accepted if bid.created_at >= month_start])
    avg_job_value_cents = total_cents // jobs_total if jobs_total > 0 else 0

    return EarningsOut(
        total_cents=total_cents,
        pending_cents=0,
        this_month_cents=this_month_cents,
        jobs_total=jobs_total,
        jobs_this_month=jobs_this_month,
        avg_job_value_cents=avg_job_value_cents,
    )


@router.get("/reviews", response_model=list[ReviewOut])
def list_reviews(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> list[ReviewOut]:
    reviews = (
        db.query(Review)
        .filter(Review.provider_id == current_user.id)
        .order_by(Review.created_at.desc())
        .all()
    )
    result = []
    for review in reviews:
        homeowner = db.query(User).filter(User.id == review.homeowner_id).first()
        result.append(
            ReviewOut(
                id=review.id,
                homeowner_id=review.homeowner_id,
                homeowner_name=homeowner.full_name if homeowner else "Unknown",
                bid_id=review.bid_id,
                stars=review.stars,
                comment=review.comment,
                tag=review.tag,
                created_at=review.created_at,
            )
        )
    return result


@router.post("/reviews", response_model=ReviewOut, status_code=http_status.HTTP_201_CREATED)
def create_review(
    payload: ReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> ReviewOut:
    bid = db.query(Bid).filter(Bid.id == payload.bid_id).first()
    if not bid or bid.status != "accepted":
        raise HTTPException(status_code=400, detail="Can only review an accepted bid")
    existing = db.query(Review).filter(Review.bid_id == payload.bid_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already reviewed")
    review = Review(
        provider_id=bid.provider_id,
        homeowner_id=current_user.id,
        bid_id=bid.id,
        stars=payload.stars,
        comment=payload.comment,
        tag=payload.tag,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return ReviewOut(
        id=review.id,
        homeowner_id=review.homeowner_id,
        homeowner_name=current_user.full_name,
        bid_id=review.bid_id,
        stars=review.stars,
        comment=review.comment,
        tag=review.tag,
        created_at=review.created_at,
    )
