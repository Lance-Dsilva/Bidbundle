import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db, require_role
from models.bid import Bid
from models.community import ActivityLog, CommunityMember, HOA, Invite, MembershipRequest
from models.request import ServiceRequest
from models.user import User
from schemas.community import (
    CommunityMemberOut,
    HOAOut,
    HoaMemberOut,
    HoaStatsOut,
    InviteCreate,
    InviteOut,
    MembershipRequestOut,
    MyStatusOut,
)

router = APIRouter(prefix="/community", tags=["community"])


class CommunityJoinIn(BaseModel):
    hoa_id: int
    address: str


def _get_member_or_404(db: Session, member_id: int) -> CommunityMember:
    member = db.query(CommunityMember).filter(CommunityMember.id == member_id).first()
    if member is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Member not found")
    return member


def _get_admin_hoa(db: Session, current_user: User) -> HOA:
    hoa = db.query(HOA).filter(HOA.admin_user_id == current_user.id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="No community found for this admin")
    return hoa


# ── Existing endpoints ────────────────────────────────────────────────────────

@router.get("/members", response_model=list[CommunityMemberOut])
def list_members(
    eligibility: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CommunityMemberOut]:
    query = db.query(CommunityMember)
    if eligibility is not None:
        query = query.filter(CommunityMember.eligibility == eligibility)
    return query.order_by(CommunityMember.created_at.desc()).all()


@router.post("/join", response_model=CommunityMemberOut, status_code=http_status.HTTP_201_CREATED)
def join_community(
    payload: CommunityJoinIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> CommunityMemberOut:
    hoa = db.query(HOA).filter(HOA.id == payload.hoa_id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="HOA not found")

    member = CommunityMember(
        user_id=current_user.id,
        hoa_id=payload.hoa_id,
        eligibility="pending",
        address=payload.address,
    )
    db.add(member)
    db.flush()

    db.add(
        ActivityLog(
            hoa_id=payload.hoa_id,
            type="join",
            description=f"{current_user.full_name} applied to join",
        )
    )
    db.commit()
    db.refresh(member)
    return member


@router.put("/members/{id}/approve", response_model=CommunityMemberOut)
def approve_member(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> CommunityMemberOut:
    member = _get_member_or_404(db, id)
    member.eligibility = "verified"
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/members/{id}/decline", response_model=CommunityMemberOut)
def decline_member(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> CommunityMemberOut:
    member = _get_member_or_404(db, id)
    member.eligibility = "ineligible"
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


# ── HOA Admin endpoints ───────────────────────────────────────────────────────

@router.get("/mine", response_model=HOAOut)
def get_my_community(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> HOAOut:
    return _get_admin_hoa(db, current_user)


@router.get("/{hoa_id}/members", response_model=list[HoaMemberOut])
def list_hoa_members(
    hoa_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> list[HoaMemberOut]:
    hoa = db.query(HOA).filter(HOA.id == hoa_id, HOA.admin_user_id == current_user.id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not your community")

    residents = db.query(User).filter(User.community_id == hoa_id).all()
    return [
        HoaMemberOut(
            user_id=u.id,
            full_name=u.full_name,
            email=u.email,
            unit_number=u.unit_number,
            eligibility="verified",
            created_at=u.created_at,
        )
        for u in residents
    ]


@router.post("/{hoa_id}/invite", response_model=InviteOut, status_code=http_status.HTTP_201_CREATED)
def create_invite(
    hoa_id: int,
    payload: InviteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> InviteOut:
    hoa = db.query(HOA).filter(HOA.id == hoa_id, HOA.admin_user_id == current_user.id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not your community")

    code = secrets.token_urlsafe(9)
    invite = Invite(
        hoa_id=hoa_id,
        email=payload.email,
        code=code,
        unit_number=payload.unit_number,
        status="pending",
        created_by=current_user.id,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


@router.delete("/{hoa_id}/members/{user_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def remove_member(
    hoa_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> None:
    hoa = db.query(HOA).filter(HOA.id == hoa_id, HOA.admin_user_id == current_user.id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not your community")

    resident = db.query(User).filter(User.id == user_id, User.community_id == hoa_id).first()
    if resident is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Member not found")

    resident.community_id = None
    resident.unit_number = None

    # Mark their membership request as revoked
    req = (
        db.query(MembershipRequest)
        .filter(MembershipRequest.user_id == user_id, MembershipRequest.hoa_id == hoa_id)
        .first()
    )
    if req:
        req.status = "revoked"
        req.reviewed_at = datetime.utcnow()
        req.reviewed_by_id = current_user.id

    db.commit()


@router.get("/{hoa_id}/stats", response_model=HoaStatsOut)
def get_hoa_stats(
    hoa_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> HoaStatsOut:
    hoa = db.query(HOA).filter(HOA.id == hoa_id, HOA.admin_user_id == current_user.id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Not your community")

    total_members = db.query(User).filter(User.community_id == hoa_id).count()
    resident_ids = [u.id for u in db.query(User.id).filter(User.community_id == hoa_id).all()]
    active_requests = (
        db.query(ServiceRequest)
        .filter(ServiceRequest.user_id.in_(resident_ids), ServiceRequest.status == "live")
        .count()
        if resident_ids else 0
    )
    total_savings = (
        db.query(Bid)
        .join(ServiceRequest, ServiceRequest.id == Bid.request_id)
        .filter(ServiceRequest.user_id.in_(resident_ids), Bid.status == "accepted")
        .with_entities(Bid.amount)
        .all()
        if resident_ids else []
    )
    savings_total = sum(r.amount for r in total_savings) if total_savings else 0

    return HoaStatsOut(
        community_name=hoa.name,
        community_type=hoa.type,
        total_members=total_members,
        active_requests=active_requests,
        total_savings=int(savings_total),
        master_invite_code=hoa.master_invite_code,
    )


# ── Membership request endpoints (admin) ─────────────────────────────────────

@router.get("/mine/requests", response_model=list[MembershipRequestOut])
def list_membership_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> list[MembershipRequestOut]:
    hoa = _get_admin_hoa(db, current_user)
    requests = (
        db.query(MembershipRequest)
        .filter(MembershipRequest.hoa_id == hoa.id)
        .order_by(MembershipRequest.created_at.desc())
        .all()
    )
    result = []
    for req in requests:
        member = db.query(User).filter(User.id == req.user_id).first()
        if member:
            result.append(MembershipRequestOut(
                id=req.id,
                user_id=req.user_id,
                hoa_id=req.hoa_id,
                status=req.status,
                note=req.note,
                created_at=req.created_at,
                reviewed_at=req.reviewed_at,
                full_name=member.full_name,
                email=member.email,
                unit_number=member.unit_number,
            ))
    return result


@router.post("/requests/{request_id}/approve", status_code=http_status.HTTP_200_OK)
def approve_membership_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> dict:
    hoa = _get_admin_hoa(db, current_user)
    req = db.query(MembershipRequest).filter(
        MembershipRequest.id == request_id,
        MembershipRequest.hoa_id == hoa.id,
    ).first()
    if req is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Request is not pending")

    req.status = "approved"
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by_id = current_user.id

    member = db.query(User).filter(User.id == req.user_id).first()
    if member:
        member.community_id = hoa.id

    db.commit()
    return {"status": "approved"}


@router.post("/requests/{request_id}/decline", status_code=http_status.HTTP_200_OK)
def decline_membership_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> dict:
    hoa = _get_admin_hoa(db, current_user)
    req = db.query(MembershipRequest).filter(
        MembershipRequest.id == request_id,
        MembershipRequest.hoa_id == hoa.id,
    ).first()
    if req is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Request is not pending")

    req.status = "declined"
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by_id = current_user.id

    db.commit()
    return {"status": "declined"}


# ── HOA Homeowner endpoints ───────────────────────────────────────────────────

@router.get("/my-community", response_model=HOAOut)
def get_my_hoa_community(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("hoa_homeowner")),
) -> HOAOut:
    if current_user.community_id is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="No community assigned")
    hoa = db.query(HOA).filter(HOA.id == current_user.community_id).first()
    if hoa is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Community not found")
    return hoa


@router.get("/my-status", response_model=MyStatusOut)
def get_my_membership_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("hoa_homeowner")),
) -> MyStatusOut:
    if current_user.community_id is not None:
        hoa = db.query(HOA).filter(HOA.id == current_user.community_id).first()
        return MyStatusOut(
            status="approved",
            hoa_name=hoa.name if hoa else None,
            hoa_id=current_user.community_id,
        )

    req = (
        db.query(MembershipRequest)
        .filter(MembershipRequest.user_id == current_user.id)
        .order_by(MembershipRequest.created_at.desc())
        .first()
    )
    if req is None:
        return MyStatusOut(status="none")

    hoa = db.query(HOA).filter(HOA.id == req.hoa_id).first()
    return MyStatusOut(
        status=req.status,
        hoa_name=hoa.name if hoa else None,
        hoa_id=req.hoa_id,
        request_id=req.id,
    )
