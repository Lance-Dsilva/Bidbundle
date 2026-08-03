from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from dependencies import get_current_user, get_db, require_role
from models.message import ChannelMember, GroupChannel
from models.neighbourhood import NeighbourhoodChannel, NeighbourhoodChannelMember
from models.notification import Notification
from models.request import ServiceRequest
from models.request_group import GroupMember, RequestGroup
from models.user import User
from schemas.request import ServiceRequestCreate, ServiceRequestList, ServiceRequestOut

router = APIRouter(tags=["requests"])


class ServiceRequestUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None


def _sync_group_channel_members(db: Session, group: RequestGroup) -> None:
    active_members = [
        member for member in group.members
        if member.approval_status != "cancelled"
    ]
    if len(active_members) < 2:
        return

    member_req_ids = [member.request_id for member in active_members]
    channel = (
        db.query(GroupChannel)
        .filter(GroupChannel.request_id.in_(member_req_ids))
        .first()
    )
    if not channel:
        first_req = (
            db.query(ServiceRequest)
            .filter(ServiceRequest.id == active_members[0].request_id)
            .first()
        )
        if not first_req:
            return
        channel = GroupChannel(request_id=first_req.id)
        db.add(channel)
        db.commit()
        db.refresh(channel)

    for member in active_members:
        already_in = db.query(ChannelMember).filter(
            ChannelMember.channel_id == channel.id,
            ChannelMember.user_id == member.user_id,
        ).first()
        if not already_in:
            db.add(ChannelMember(channel_id=channel.id, user_id=member.user_id))
    db.commit()


def _find_target_group(
    db: Session,
    current_user: User,
    payload: ServiceRequestCreate,
    now: datetime,
) -> RequestGroup | None:
    active_statuses = ("grouping", "pending_approval", "bidding")
    group_query = db.query(RequestGroup).filter(
        RequestGroup.category == payload.category,
        RequestGroup.status.in_(active_statuses),
    )

    if payload.group_id is not None:
        group_query = group_query.filter(RequestGroup.id == payload.group_id)
    if current_user.neighbourhood_id:
        group_query = group_query.filter(
            RequestGroup.neighbourhood_id == current_user.neighbourhood_id,
            RequestGroup.neighborhood == payload.neighborhood,
        )
    else:
        group_query = group_query.filter(RequestGroup.neighborhood == payload.neighborhood)

    groups = group_query.order_by(RequestGroup.created_at.desc()).all()
    if payload.group_id is not None:
        return groups[0] if groups else None

    status_rank = {"grouping": 0, "pending_approval": 1, "bidding": 2}
    active_groups = [
        group for group in groups
        if group.status != "grouping" or group.grouping_closes_at > now
    ]
    if not active_groups:
        return None
    return sorted(
        active_groups,
        key=lambda group: (
            status_rank.get(group.status, 99),
            -group.created_at.timestamp(),
        ),
    )[0]


def _get_request_or_404(db: Session, request_id: int) -> ServiceRequest:
    service_request = (
        db.query(ServiceRequest)
        .options(selectinload(ServiceRequest.bids))
        .filter(ServiceRequest.id == request_id)
        .first()
    )
    if service_request is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Request not found")
    return service_request


@router.get("/requests", response_model=list[ServiceRequestList])
def list_requests(
    neighborhood: str | None = None,
    status: str | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
) -> list[ServiceRequestList]:
    query = db.query(ServiceRequest)
    if neighborhood is not None:
        query = query.filter(ServiceRequest.neighborhood == neighborhood)
    if status is not None:
        query = query.filter(ServiceRequest.status == status)
    if category is not None:
        query = query.filter(ServiceRequest.category == category)
    return query.order_by(ServiceRequest.created_at.desc()).all()


@router.post("/requests", response_model=ServiceRequestOut, status_code=http_status.HTTP_201_CREATED)
def create_request(
    payload: ServiceRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> ServiceRequestOut:
    now = datetime.utcnow()
    active_group = _find_target_group(db, current_user, payload, now)

    if active_group is not None:
        existing_membership = db.query(GroupMember).filter(
            GroupMember.group_id == active_group.id,
            GroupMember.user_id == current_user.id,
            GroupMember.approval_status != "cancelled",
        ).first()
        if existing_membership:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="You already joined this group",
            )

    service_request = ServiceRequest(
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        neighborhood=payload.neighborhood,
        status="live",
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
    )
    db.add(service_request)
    db.commit()
    db.refresh(service_request)

    if active_group:
        service_request.group_id = active_group.id

        approval_status = "approved" if active_group.status == "bidding" else "pending"
        db.add(
            GroupMember(
                group_id=active_group.id,
                user_id=current_user.id,
                request_id=service_request.id,
                approval_status=approval_status,
            )
        )
        db.commit()
        db.refresh(service_request)

        existing_members = (
            db.query(GroupMember)
            .filter(
                GroupMember.group_id == active_group.id,
                GroupMember.user_id != current_user.id,
                GroupMember.approval_status != "cancelled",
            )
            .all()
        )
        for member in existing_members:
            db.add(
                Notification(
                    user_id=member.user_id,
                    type="group_member_joined",
                    title=f"A neighbour joined your {active_group.category} group",
                    body=(
                        f"{current_user.full_name} just joined the group - "
                        "the more neighbours, the better the deal."
                    ),
                    action_url="/app/homeowner/bids",
                )
            )
        db.commit()
        db.refresh(active_group)
        _sync_group_channel_members(db, active_group)

        response = ServiceRequestOut.model_validate(service_request)
        response.matched_group_id = active_group.id
        response.group_id = active_group.id
        response.group_status = active_group.status
        return response

    new_group = RequestGroup(
        category=payload.category,
        neighbourhood_id=current_user.neighbourhood_id,
        neighborhood=payload.neighborhood,
        status="grouping",
        grouping_closes_at=now + timedelta(hours=72),
        created_by_user_id=current_user.id,
    )
    db.add(new_group)
    db.commit()
    db.refresh(new_group)

    service_request.group_id = new_group.id
    db.add(
        GroupMember(
            group_id=new_group.id,
            user_id=current_user.id,
            request_id=service_request.id,
            approval_status="pending",
        )
    )
    db.commit()
    db.refresh(service_request)

    if current_user.neighbourhood_id:
        members = (
            db.query(NeighbourhoodChannelMember)
            .join(
                NeighbourhoodChannel,
                NeighbourhoodChannelMember.channel_id == NeighbourhoodChannel.id,
            )
            .filter(
                NeighbourhoodChannel.neighbourhood_id == current_user.neighbourhood_id,
                NeighbourhoodChannelMember.user_id != current_user.id,
            )
            .all()
        )
        neighbour_ids = [member.user_id for member in members]
    else:
        neighbour_ids = []

    for user_id in neighbour_ids:
        db.add(
            Notification(
                user_id=user_id,
                type="group_created",
                title=f"New {payload.category} group in your area",
                body=(
                    f"{current_user.full_name} started a group for {payload.category} services. "
                    "Add your request in the next 72 hours to get a group deal."
                ),
                action_url="/app/homeowner/request",
            )
        )
    db.commit()

    matched_request = (
        db.query(ServiceRequest)
        .filter(
            ServiceRequest.id != service_request.id,
            ServiceRequest.category == service_request.category,
            ServiceRequest.neighborhood == service_request.neighborhood,
            ServiceRequest.status.in_(("grouping", "live")),
        )
        .order_by(ServiceRequest.created_at.desc())
        .first()
    )
    if matched_request:
        channel = db.query(GroupChannel).filter(GroupChannel.request_id == matched_request.id).first()
        if channel:
            already = db.query(ChannelMember).filter(
                ChannelMember.channel_id == channel.id,
                ChannelMember.user_id == service_request.user_id,
            ).first()
            if not already:
                db.add(ChannelMember(channel_id=channel.id, user_id=service_request.user_id))
                db.commit()

    response = ServiceRequestOut.model_validate(service_request)
    response.matched_group_id = new_group.id
    response.group_id = new_group.id
    response.group_status = new_group.status
    return response


@router.get("/requests/{id}", response_model=ServiceRequestOut)
def get_request(id: int, db: Session = Depends(get_db)) -> ServiceRequestOut:
    return _get_request_or_404(db, id)


@router.put("/requests/{id}", response_model=ServiceRequestOut)
def update_request(
    id: int,
    payload: ServiceRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ServiceRequestOut:
    service_request = _get_request_or_404(db, id)
    if current_user.id != service_request.user_id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Forbidden")

    for field in ("title", "description", "status"):
        value = getattr(payload, field)
        if value is not None:
            setattr(service_request, field, value)

    db.add(service_request)
    db.commit()
    db.refresh(service_request)
    return service_request


@router.delete("/requests/{id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_request(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    service_request = _get_request_or_404(db, id)
    if current_user.id != service_request.user_id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if service_request.status != "draft":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Only draft requests can be deleted",
        )

    db.delete(service_request)
    db.commit()
    return Response(status_code=http_status.HTTP_204_NO_CONTENT)
