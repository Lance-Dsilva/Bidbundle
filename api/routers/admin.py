from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from dependencies import get_db, require_role
from models.bid import Bid
from models.community import ActivityLog, CommunityMember
from models.request import ServiceRequest
from models.user import User
from schemas.community import ActivityLogOut, AdminStatsOut, SavingsCategoryOut, SavingsReportOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/reports/savings", response_model=SavingsReportOut)
def get_savings_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> SavingsReportOut:
    rows = (
        db.query(
            ServiceRequest.category.label("name"),
            func.sum(Bid.amount).label("saved"),
            func.count(Bid.id).label("bids"),
        )
        .join(ServiceRequest, ServiceRequest.id == Bid.request_id)
        .filter(ServiceRequest.status == "closed")
        .group_by(ServiceRequest.category)
        .order_by(ServiceRequest.category.asc())
        .all()
    )

    categories = [
        SavingsCategoryOut(
            name=row.name,
            saved=int(row.saved or 0),
            bids=int(row.bids or 0),
        )
        for row in rows
    ]
    total = sum(category.saved for category in categories)
    return SavingsReportOut(categories=categories, total=total)


@router.get("/activity", response_model=list[ActivityLogOut])
def get_activity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> list[ActivityLogOut]:
    return db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(20).all()


@router.get("/stats", response_model=AdminStatsOut)
def get_admin_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
) -> AdminStatsOut:
    total_members = db.query(func.count(CommunityMember.id)).scalar() or 0
    active_bids = db.query(func.count(ServiceRequest.id)).filter(ServiceRequest.status == "live").scalar() or 0
    total_savings = db.query(func.sum(Bid.amount)).filter(Bid.status == "accepted").scalar() or 0

    return AdminStatsOut(
        total_members=int(total_members),
        active_bids=int(active_bids),
        monthly_savings=int(total_savings),
        total_savings_all_time=int(total_savings),
    )
