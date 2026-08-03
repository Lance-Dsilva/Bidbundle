import os
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db
from models.community import HOA
from models.request import ServiceRequest
from models.user import User

router = APIRouter(prefix="/hoa-ai", tags=["hoa-ai"])


def _require_admin(current_user: User) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="HOA manager role required")
    return current_user


def _get_hoa_for_admin(db: Session, current_user: User) -> HOA:
    hoa = db.query(HOA).filter(HOA.admin_user_id == current_user.id).first()
    if not hoa:
        raise HTTPException(status_code=404, detail="No community found for this manager")
    return hoa


def _get_community_data(db: Session, hoa: HOA) -> dict:
    members = db.query(User).filter(User.community_id == hoa.id).all()
    member_ids = [m.id for m in members]
    requests = (
        db.query(ServiceRequest)
        .filter(ServiceRequest.user_id.in_(member_ids))
        .order_by(ServiceRequest.created_at.desc())
        .limit(50)
        .all()
    ) if member_ids else []
    active_requests = [r for r in requests if r.status not in ("closed",)]
    category_counts = Counter(r.category for r in requests)
    return {
        "hoa": hoa,
        "members": members,
        "all_requests": requests,
        "active_requests": active_requests,
        "category_counts": category_counts,
    }


def _call_openai(system: str, user_msg: str) -> str | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.6,
            max_tokens=600,
        )
        return response.choices[0].message.content or ""
    except Exception:
        return None


# ── Digest ───────────────────────────────────────────────────────────────────

class DigestResponse(BaseModel):
    digest: str
    member_count: int
    active_request_count: int
    top_category: str | None


@router.get("/digest", response_model=DigestResponse)
def get_community_digest(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _get_hoa_for_admin(db, current_user)
    data = _get_community_data(db, hoa)

    members = data["members"]
    active = data["active_requests"]
    cats = data["category_counts"]
    top_cat = cats.most_common(1)[0][0] if cats else None

    system = (
        "You are a community manager assistant for BidBundle, a neighbourhood service-bidding platform. "
        "Write a warm, concise weekly community digest (3-4 sentences) for an HOA manager. "
        "Be specific with numbers. Focus on activity, savings potential, and next actions. "
        "No bullet points. Plain paragraph. Friendly but professional tone."
    )
    user_msg = (
        f"Community: {hoa.name} ({hoa.type or 'HOA'})\n"
        f"Total residents: {len(members)}\n"
        f"Active service requests: {len(active)}\n"
        f"Most requested service: {top_cat or 'none yet'}\n"
        f"Recent request categories: {dict(list(cats.items())[:5]) or 'none'}\n"
        "Write a digest the HOA manager can read at a glance."
    )
    text = _call_openai(system, user_msg)
    if not text:
        n = len(members)
        text = (
            f"{hoa.name} has {n} resident{'s' if n != 1 else ''} and "
            f"{len(active)} active service request{'s' if len(active) != 1 else ''}. "
            + (f"The most requested service is {top_cat}. " if top_cat else "")
            + "Invite more residents to unlock group discounts."
        )

    return DigestResponse(
        digest=text,
        member_count=len(members),
        active_request_count=len(active),
        top_category=top_cat,
    )


# ── Announcement composer ─────────────────────────────────────────────────────

class AnnouncementRequest(BaseModel):
    rough_text: str


class AnnouncementResponse(BaseModel):
    announcement: str
    subject_line: str


@router.post("/announcement", response_model=AnnouncementResponse)
def compose_announcement(
    payload: AnnouncementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _get_hoa_for_admin(db, current_user)

    if not payload.rough_text.strip():
        raise HTTPException(status_code=400, detail="rough_text is required")

    system = (
        "You are a community communications assistant for BidBundle. "
        "Given rough notes from an HOA manager, write a polished resident announcement. "
        "Output JSON with two keys: 'subject_line' (short, max 8 words) and 'announcement' (2-3 sentences, friendly, clear). "
        "Return ONLY the JSON, no markdown."
    )
    user_msg = (
        f"Community name: {hoa.name}\n"
        f"Manager's rough notes: {payload.rough_text[:500]}\n"
        "Write the polished announcement."
    )
    text = _call_openai(system, user_msg)

    import json
    subject = "Community Update"
    announcement = payload.rough_text
    if text:
        try:
            parsed = json.loads(text)
            subject = parsed.get("subject_line", subject)
            announcement = parsed.get("announcement", announcement)
        except Exception:
            # If JSON parse fails, use the whole response as announcement
            announcement = text
            subject = "Community Update"

    return AnnouncementResponse(announcement=announcement, subject_line=subject)


# ── Savings opportunities ─────────────────────────────────────────────────────

class Opportunity(BaseModel):
    category: str
    request_count: int
    estimated_saving_pct: int
    suggestion: str


class OpportunitiesResponse(BaseModel):
    opportunities: list[Opportunity]
    summary: str


@router.get("/opportunities", response_model=OpportunitiesResponse)
def get_savings_opportunities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _get_hoa_for_admin(db, current_user)
    data = _get_community_data(db, hoa)

    cats = data["category_counts"]
    active = data["active_requests"]
    members = data["members"]

    # Build groupable categories (2+ requests in same category)
    groupable = [(cat, cnt) for cat, cnt in cats.items() if cnt >= 2]

    system = (
        "You are a savings analyst for BidBundle, a group-bidding home services platform. "
        "Analyse the community's service request data and identify opportunities to save money by grouping requests. "
        "Return ONLY a JSON array of opportunity objects (max 4). "
        "Each object: {\"category\": string, \"request_count\": number, \"estimated_saving_pct\": number (10-40), \"suggestion\": string (1 sentence)}. "
        "No markdown, no explanation outside the JSON array."
    )
    user_msg = (
        f"Community: {hoa.name} with {len(members)} residents\n"
        f"Active requests by category: {dict(cats) or 'none'}\n"
        f"Categories with 2+ requests (groupable): {groupable or 'none'}\n"
        f"Total active requests: {len(active)}\n"
        "Identify the best group-bidding opportunities."
    )
    text = _call_openai(system, user_msg)

    import json
    opportunities: list[Opportunity] = []
    if text:
        try:
            parsed = json.loads(text)
            for item in parsed[:4]:
                opportunities.append(Opportunity(
                    category=item.get("category", "Unknown"),
                    request_count=int(item.get("request_count", 1)),
                    estimated_saving_pct=int(item.get("estimated_saving_pct", 15)),
                    suggestion=item.get("suggestion", ""),
                ))
        except Exception:
            pass

    # Fallback: build from raw data if AI failed or returned nothing
    if not opportunities:
        for cat, cnt in sorted(cats.items(), key=lambda x: -x[1])[:3]:
            pct = min(40, 10 + cnt * 5)
            opportunities.append(Opportunity(
                category=cat,
                request_count=cnt,
                estimated_saving_pct=pct,
                suggestion=f"Group {cnt} {cat} requests to unlock an estimated {pct}% group discount.",
            ))

    total_groupable = sum(o.request_count for o in opportunities)
    summary = (
        f"{len(opportunities)} grouping opportunit{'ies' if len(opportunities) != 1 else 'y'} found "
        f"across {total_groupable} active requests."
        if opportunities else
        "No grouping opportunities yet. Encourage residents to post service requests."
    )

    return OpportunitiesResponse(opportunities=opportunities, summary=summary)
