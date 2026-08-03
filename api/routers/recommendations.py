from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db, require_role
from models.user import User
from services.recommender import (
    group_opportunities,
    rank_bids_for_request,
    ranked_job_feed,
    recommendation_summary,
    suggest_bid_price,
)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("/bids/{request_id}")
def get_bid_recommendations(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> dict:
    """
    Ranked bids for a homeowner's service request.
    Top bid has is_top_pick=True and the highest score.
    """
    ranked = rank_bids_for_request(db, request_id)
    return {
        "request_id": request_id,
        "total": len(ranked),
        "bids": ranked,
    }


@router.get("/jobs")
def get_job_recommendations(
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> dict:
    """
    Personalised, ranked job feed for the provider.
    Each entry includes match_pct (0-100) and a reason string.
    """
    jobs = ranked_job_feed(db, current_user.id, category=category)
    return {
        "provider_id": current_user.id,
        "total": len(jobs),
        "jobs": jobs,
    }


@router.get("/bid-price/{request_id}")
def get_bid_price_suggestion(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("provider")),
) -> dict:
    """
    Suggest a winning price range for a provider to bid on a request.
    Uses distribution of accepted bids in the same category.
    """
    return suggest_bid_price(db, request_id)


@router.get("/groups")
def get_group_opportunities(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("homeowner")),
) -> dict:
    """
    Nearby group bid opportunities the homeowner could join.
    Filters to their own neighborhood and sorts by category relevance.
    """
    opps = group_opportunities(db, current_user.id)
    return {
        "user_id": current_user.id,
        "total": len(opps),
        "opportunities": opps,
    }


@router.get("/summary")
def get_recommendation_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Single top recommendation for the dashboard nudge card.
    Works for both homeowners and providers.
    Returns action, headline, sub-text, and relevant IDs.
    """
    return recommendation_summary(db, current_user)
