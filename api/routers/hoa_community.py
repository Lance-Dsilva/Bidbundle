from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db
from models.community import HOA
from models.user import User

router = APIRouter(prefix="/hoa-community", tags=["hoa-community"])

COMPLAINT_CATEGORIES = ["General", "Noise", "Parking", "Maintenance", "Safety", "Other"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _require_admin(user: User) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="HOA manager role required")
    return user


def _require_resident(user: User) -> User:
    if user.role != "hoa_homeowner":
        raise HTTPException(status_code=403, detail="HOA resident role required")
    if not user.community_id:
        raise HTTPException(status_code=403, detail="Not yet approved by HOA manager")
    return user


def _hoa_for_admin(db: Session, user: User) -> HOA:
    hoa = db.query(HOA).filter(HOA.admin_user_id == user.id).first()
    if not hoa:
        raise HTTPException(status_code=404, detail="No community found for this manager")
    return hoa


def _hoa_for_user(db: Session, user: User) -> HOA:
    """Works for both admin and approved resident."""
    if user.role == "admin":
        return _hoa_for_admin(db, user)
    if user.role == "hoa_homeowner":
        if not user.community_id:
            raise HTTPException(status_code=403, detail="Not yet approved")
        hoa = db.query(HOA).filter(HOA.id == user.community_id).first()
        if not hoa:
            raise HTTPException(status_code=404, detail="Community not found")
        return hoa
    raise HTTPException(status_code=403, detail="Forbidden")


def _raw(db: Session, sql: str, params: dict = {}) -> list[dict]:
    from sqlalchemy import text
    rows = db.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def _exec(db: Session, sql: str, params: dict = {}) -> None:
    from sqlalchemy import text
    db.execute(text(sql), params)
    db.commit()


# ── Announcement schemas ──────────────────────────────────────────────────────

class AnnouncementCreate(BaseModel):
    title: str
    body: str
    pinned: bool = False


class AnnouncementOut(BaseModel):
    id: int
    hoa_id: int
    title: str
    body: str
    pinned: bool
    created_by_name: str
    created_at: str


# ── Announcement endpoints ────────────────────────────────────────────────────

@router.get("/announcements", response_model=list[AnnouncementOut])
def list_announcements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    hoa = _hoa_for_user(db, current_user)
    rows = _raw(db, """
        SELECT a.id, a.hoa_id, a.title, a.body, a.pinned,
               u.full_name AS created_by_name,
               a.created_at
        FROM hoa_announcements a
        JOIN users u ON u.id = a.created_by_id
        WHERE a.hoa_id = :hoa_id
        ORDER BY a.pinned DESC, a.created_at DESC
    """, {"hoa_id": hoa.id})
    for r in rows:
        r["pinned"] = bool(r["pinned"])
        r["created_at"] = str(r["created_at"])
    return rows


@router.post("/announcements", response_model=AnnouncementOut, status_code=201)
def create_announcement(
    payload: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    if not payload.title.strip() or not payload.body.strip():
        raise HTTPException(status_code=400, detail="Title and body are required")
    _exec(db, """
        INSERT INTO hoa_announcements (hoa_id, title, body, pinned, created_by_id, created_at)
        VALUES (:hoa_id, :title, :body, :pinned, :created_by_id, :now)
    """, {
        "hoa_id": hoa.id, "title": payload.title.strip(),
        "body": payload.body.strip(), "pinned": 1 if payload.pinned else 0,
        "created_by_id": current_user.id, "now": datetime.utcnow().isoformat(),
    })
    rows = _raw(db, """
        SELECT a.id, a.hoa_id, a.title, a.body, a.pinned,
               u.full_name AS created_by_name, a.created_at
        FROM hoa_announcements a JOIN users u ON u.id = a.created_by_id
        WHERE a.hoa_id = :hoa_id ORDER BY a.id DESC LIMIT 1
    """, {"hoa_id": hoa.id})
    r = rows[0]
    r["pinned"] = bool(r["pinned"])
    r["created_at"] = str(r["created_at"])
    return r


@router.patch("/announcements/{announcement_id}/pin", response_model=AnnouncementOut)
def toggle_pin(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    rows = _raw(db, "SELECT * FROM hoa_announcements WHERE id=:id AND hoa_id=:hoa_id",
                {"id": announcement_id, "hoa_id": hoa.id})
    if not rows:
        raise HTTPException(status_code=404, detail="Announcement not found")
    new_pin = 0 if rows[0]["pinned"] else 1
    _exec(db, "UPDATE hoa_announcements SET pinned=:p WHERE id=:id", {"p": new_pin, "id": announcement_id})
    rows = _raw(db, """
        SELECT a.id, a.hoa_id, a.title, a.body, a.pinned,
               u.full_name AS created_by_name, a.created_at
        FROM hoa_announcements a JOIN users u ON u.id = a.created_by_id
        WHERE a.id = :id
    """, {"id": announcement_id})
    r = rows[0]
    r["pinned"] = bool(r["pinned"])
    r["created_at"] = str(r["created_at"])
    return r


@router.delete("/announcements/{announcement_id}", status_code=204)
def delete_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    rows = _raw(db, "SELECT id FROM hoa_announcements WHERE id=:id AND hoa_id=:hoa_id",
                {"id": announcement_id, "hoa_id": hoa.id})
    if not rows:
        raise HTTPException(status_code=404, detail="Announcement not found")
    _exec(db, "DELETE FROM hoa_announcements WHERE id=:id", {"id": announcement_id})


# ── Complaint schemas ─────────────────────────────────────────────────────────

class ComplaintCreate(BaseModel):
    title: str
    description: str
    category: str = "General"


class ComplaintStatusUpdate(BaseModel):
    status: str  # open | in_progress | resolved


class ComplaintOut(BaseModel):
    id: int
    hoa_id: int
    resident_id: int
    resident_name: str
    title: str
    description: str
    category: str
    status: str
    created_at: str
    resolved_at: str | None


# ── Complaint endpoints ───────────────────────────────────────────────────────

@router.post("/complaints", response_model=ComplaintOut, status_code=201)
def raise_complaint(
    payload: ComplaintCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_resident(current_user)
    if not payload.title.strip() or not payload.description.strip():
        raise HTTPException(status_code=400, detail="Title and description are required")
    category = payload.category if payload.category in COMPLAINT_CATEGORIES else "General"
    _exec(db, """
        INSERT INTO hoa_complaints
            (hoa_id, resident_id, title, description, category, status, created_at)
        VALUES (:hoa_id, :resident_id, :title, :description, :category, 'open', :now)
    """, {
        "hoa_id": current_user.community_id, "resident_id": current_user.id,
        "title": payload.title.strip(), "description": payload.description.strip(),
        "category": category, "now": datetime.utcnow().isoformat(),
    })
    rows = _raw(db, """
        SELECT c.*, u.full_name AS resident_name
        FROM hoa_complaints c JOIN users u ON u.id = c.resident_id
        WHERE c.hoa_id = :hoa_id AND c.resident_id = :rid
        ORDER BY c.id DESC LIMIT 1
    """, {"hoa_id": current_user.community_id, "rid": current_user.id})
    r = rows[0]
    r["created_at"] = str(r["created_at"])
    r["resolved_at"] = str(r["resolved_at"]) if r.get("resolved_at") else None
    return r


@router.get("/complaints", response_model=list[ComplaintOut])
def list_complaints(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    where = "WHERE c.hoa_id = :hoa_id"
    params: dict = {"hoa_id": hoa.id}
    if status:
        where += " AND c.status = :status"
        params["status"] = status
    rows = _raw(db, f"""
        SELECT c.*, u.full_name AS resident_name
        FROM hoa_complaints c JOIN users u ON u.id = c.resident_id
        {where} ORDER BY c.created_at DESC
    """, params)
    for r in rows:
        r["created_at"] = str(r["created_at"])
        r["resolved_at"] = str(r["resolved_at"]) if r.get("resolved_at") else None
    return rows


@router.get("/my-complaints", response_model=list[ComplaintOut])
def my_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_resident(current_user)
    rows = _raw(db, """
        SELECT c.*, u.full_name AS resident_name
        FROM hoa_complaints c JOIN users u ON u.id = c.resident_id
        WHERE c.resident_id = :rid ORDER BY c.created_at DESC
    """, {"rid": current_user.id})
    for r in rows:
        r["created_at"] = str(r["created_at"])
        r["resolved_at"] = str(r["resolved_at"]) if r.get("resolved_at") else None
    return rows


@router.post("/complaints/{complaint_id}/status", response_model=ComplaintOut)
def update_complaint_status(
    complaint_id: int,
    payload: ComplaintStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    if payload.status not in ("open", "in_progress", "resolved"):
        raise HTTPException(status_code=400, detail="Invalid status")
    rows = _raw(db, "SELECT id FROM hoa_complaints WHERE id=:id AND hoa_id=:hoa_id",
                {"id": complaint_id, "hoa_id": hoa.id})
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found")
    resolved_at = datetime.utcnow().isoformat() if payload.status == "resolved" else None
    _exec(db, "UPDATE hoa_complaints SET status=:s, resolved_at=:ra WHERE id=:id",
          {"s": payload.status, "ra": resolved_at, "id": complaint_id})
    rows = _raw(db, """
        SELECT c.*, u.full_name AS resident_name
        FROM hoa_complaints c JOIN users u ON u.id = c.resident_id
        WHERE c.id = :id
    """, {"id": complaint_id})
    r = rows[0]
    r["created_at"] = str(r["created_at"])
    r["resolved_at"] = str(r["resolved_at"]) if r.get("resolved_at") else None
    return r


# ── Rule schemas ──────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    title: str
    description: str = ""


class RuleOut(BaseModel):
    id: int
    hoa_id: int
    title: str
    description: str
    sort_order: int
    created_by_name: str
    created_at: str


# ── Rule endpoints ────────────────────────────────────────────────────────────

@router.get("/rules", response_model=list[RuleOut])
def list_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    hoa = _hoa_for_user(db, current_user)
    rows = _raw(db, """
        SELECT r.id, r.hoa_id, r.title, r.description, r.sort_order,
               u.full_name AS created_by_name, r.created_at
        FROM hoa_rules r JOIN users u ON u.id = r.created_by_id
        WHERE r.hoa_id = :hoa_id ORDER BY r.sort_order ASC, r.id ASC
    """, {"hoa_id": hoa.id})
    for r in rows:
        r["created_at"] = str(r["created_at"])
    return rows


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(
    payload: RuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    count_rows = _raw(db, "SELECT COUNT(*) AS n FROM hoa_rules WHERE hoa_id=:hoa_id", {"hoa_id": hoa.id})
    sort_order = (count_rows[0]["n"] or 0) + 1
    _exec(db, """
        INSERT INTO hoa_rules (hoa_id, title, description, sort_order, created_by_id, created_at)
        VALUES (:hoa_id, :title, :desc, :order, :created_by_id, :now)
    """, {
        "hoa_id": hoa.id, "title": payload.title.strip(),
        "desc": payload.description.strip(), "order": sort_order,
        "created_by_id": current_user.id, "now": datetime.utcnow().isoformat(),
    })
    rows = _raw(db, """
        SELECT r.id, r.hoa_id, r.title, r.description, r.sort_order,
               u.full_name AS created_by_name, r.created_at
        FROM hoa_rules r JOIN users u ON u.id = r.created_by_id
        WHERE r.hoa_id = :hoa_id ORDER BY r.id DESC LIMIT 1
    """, {"hoa_id": hoa.id})
    r = rows[0]
    r["created_at"] = str(r["created_at"])
    return r


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    rows = _raw(db, "SELECT id FROM hoa_rules WHERE id=:id AND hoa_id=:hoa_id",
                {"id": rule_id, "hoa_id": hoa.id})
    if not rows:
        raise HTTPException(status_code=404, detail="Rule not found")
    _exec(db, "DELETE FROM hoa_rules WHERE id=:id", {"id": rule_id})


# ── Poll schemas ──────────────────────────────────────────────────────────────

SERVICE_CATEGORIES = [
    "Plumbing", "Electrical", "HVAC", "Landscaping", "Cleaning",
    "Painting", "Roofing", "Pest Control", "Security", "Other",
]


class PollCreate(BaseModel):
    title: str
    description: str = ""
    category: str
    budget_min: int | None = None
    budget_max: int | None = None
    closes_in_days: int = 7


class PollVoteIn(BaseModel):
    vote: str  # yes | no


class PollOut(BaseModel):
    id: int
    hoa_id: int
    title: str
    description: str
    category: str
    budget_min: int | None
    budget_max: int | None
    status: str
    closes_at: str
    yes_count: int
    no_count: int
    total_votes: int
    my_vote: str | None
    service_request_id: int | None
    created_at: str


class PollBidOut(BaseModel):
    bid_id: int
    provider_name: str
    amount: int
    estimated_days: int
    work_days: str
    status: str
    submitted_at: str


def _poll_out(row: dict, my_vote: str | None) -> dict:
    row["yes_count"] = row.get("yes_count") or 0
    row["no_count"] = row.get("no_count") or 0
    row["total_votes"] = row["yes_count"] + row["no_count"]
    row["my_vote"] = my_vote
    row["closes_at"] = str(row["closes_at"])
    row["created_at"] = str(row["created_at"])
    row["budget_min"] = row.get("budget_min")
    row["budget_max"] = row.get("budget_max")
    row["service_request_id"] = row.get("service_request_id")
    return row


# ── Poll endpoints ────────────────────────────────────────────────────────────

@router.post("/polls", response_model=PollOut, status_code=201)
def create_poll(
    payload: PollCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    category = payload.category if payload.category in SERVICE_CATEGORIES else "Other"
    closes_at = (datetime.utcnow() + __import__("datetime").timedelta(days=max(1, payload.closes_in_days))).isoformat()
    _exec(db, """
        INSERT INTO hoa_polls
            (hoa_id, title, description, category, budget_min, budget_max, status, closes_at, created_by_id, created_at)
        VALUES (:hoa_id, :title, :desc, :category, :bmin, :bmax, 'open', :closes_at, :created_by_id, :now)
    """, {
        "hoa_id": hoa.id, "title": payload.title.strip(), "desc": payload.description.strip(),
        "category": category, "bmin": payload.budget_min, "bmax": payload.budget_max,
        "closes_at": closes_at, "created_by_id": current_user.id, "now": datetime.utcnow().isoformat(),
    })
    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p
        LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.hoa_id=:hoa_id GROUP BY p.id ORDER BY p.id DESC LIMIT 1
    """, {"hoa_id": hoa.id})
    return _poll_out(rows[0], None)


@router.get("/polls", response_model=list[PollOut])
def list_polls(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    hoa = _hoa_for_user(db, current_user)
    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p
        LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.hoa_id=:hoa_id GROUP BY p.id ORDER BY p.created_at DESC
    """, {"hoa_id": hoa.id})
    result = []
    for row in rows:
        my_vote_rows = _raw(db, "SELECT vote FROM hoa_poll_votes WHERE poll_id=:pid AND resident_id=:rid",
                             {"pid": row["id"], "rid": current_user.id})
        my_vote = my_vote_rows[0]["vote"] if my_vote_rows else None
        result.append(_poll_out(dict(row), my_vote))
    return result


@router.get("/polls/{poll_id}", response_model=PollOut)
def get_poll(
    poll_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    hoa = _hoa_for_user(db, current_user)
    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p
        LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.id=:pid AND p.hoa_id=:hoa_id GROUP BY p.id
    """, {"pid": poll_id, "hoa_id": hoa.id})
    if not rows:
        raise HTTPException(status_code=404, detail="Poll not found")
    my_vote_rows = _raw(db, "SELECT vote FROM hoa_poll_votes WHERE poll_id=:pid AND resident_id=:rid",
                         {"pid": poll_id, "rid": current_user.id})
    my_vote = my_vote_rows[0]["vote"] if my_vote_rows else None
    return _poll_out(dict(rows[0]), my_vote)


@router.post("/polls/{poll_id}/vote", response_model=PollOut)
def vote_poll(
    poll_id: int,
    payload: PollVoteIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_resident(current_user)
    hoa = _hoa_for_user(db, current_user)
    polls = _raw(db, "SELECT * FROM hoa_polls WHERE id=:pid AND hoa_id=:hoa_id",
                 {"pid": poll_id, "hoa_id": hoa.id})
    if not polls:
        raise HTTPException(status_code=404, detail="Poll not found")
    if polls[0]["status"] != "open":
        raise HTTPException(status_code=400, detail="Poll is not open for voting")
    if payload.vote not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="Vote must be 'yes' or 'no'")
    # Upsert vote
    existing = _raw(db, "SELECT id FROM hoa_poll_votes WHERE poll_id=:pid AND resident_id=:rid",
                    {"pid": poll_id, "rid": current_user.id})
    if existing:
        _exec(db, "UPDATE hoa_poll_votes SET vote=:v WHERE poll_id=:pid AND resident_id=:rid",
              {"v": payload.vote, "pid": poll_id, "rid": current_user.id})
    else:
        _exec(db, """
            INSERT INTO hoa_poll_votes (poll_id, resident_id, vote, created_at)
            VALUES (:pid, :rid, :v, :now)
        """, {"pid": poll_id, "rid": current_user.id, "v": payload.vote, "now": datetime.utcnow().isoformat()})
    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p
        LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.id=:pid GROUP BY p.id
    """, {"pid": poll_id})
    return _poll_out(dict(rows[0]), payload.vote)


@router.post("/polls/{poll_id}/close", response_model=PollOut)
def close_poll(
    poll_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    polls = _raw(db, "SELECT * FROM hoa_polls WHERE id=:pid AND hoa_id=:hoa_id",
                 {"pid": poll_id, "hoa_id": hoa.id})
    if not polls:
        raise HTTPException(status_code=404, detail="Poll not found")
    if polls[0]["status"] != "open":
        raise HTTPException(status_code=400, detail="Poll is already closed")
    _exec(db, "UPDATE hoa_polls SET status='closed' WHERE id=:pid", {"pid": poll_id})
    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.id=:pid GROUP BY p.id
    """, {"pid": poll_id})
    return _poll_out(dict(rows[0]), None)


@router.post("/polls/{poll_id}/launch-bid", response_model=PollOut)
def launch_poll_bid(
    poll_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    hoa = _hoa_for_admin(db, current_user)
    polls = _raw(db, "SELECT * FROM hoa_polls WHERE id=:pid AND hoa_id=:hoa_id",
                 {"pid": poll_id, "hoa_id": hoa.id})
    if not polls:
        raise HTTPException(status_code=404, detail="Poll not found")
    poll = polls[0]
    if poll["status"] == "bid_launched":
        raise HTTPException(status_code=400, detail="Bid already launched for this poll")

    from models.request import ServiceRequest
    req = ServiceRequest(
        user_id=current_user.id,
        title=poll["title"],
        description=poll["description"] or f"Community {poll['category']} service — organised by HOA manager.",
        category=poll["category"],
        neighborhood=hoa.neighborhood or hoa.name,
        status="live",
        budget_min=poll["budget_min"],
        budget_max=poll["budget_max"],
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    _exec(db, "UPDATE hoa_polls SET status='bid_launched', service_request_id=:rid WHERE id=:pid",
          {"rid": req.id, "pid": poll_id})

    rows = _raw(db, """
        SELECT p.*,
            SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) AS yes_count,
            SUM(CASE WHEN v.vote='no'  THEN 1 ELSE 0 END) AS no_count
        FROM hoa_polls p LEFT JOIN hoa_poll_votes v ON v.poll_id = p.id
        WHERE p.id=:pid GROUP BY p.id
    """, {"pid": poll_id})
    return _poll_out(dict(rows[0]), None)


@router.get("/polls/{poll_id}/bids", response_model=list[PollBidOut])
def list_poll_bids(
    poll_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    hoa = _hoa_for_user(db, current_user)
    polls = _raw(db, "SELECT * FROM hoa_polls WHERE id=:pid AND hoa_id=:hoa_id",
                 {"pid": poll_id, "hoa_id": hoa.id})
    if not polls:
        raise HTTPException(status_code=404, detail="Poll not found")
    poll = polls[0]
    if not poll.get("service_request_id"):
        return []
    rows = _raw(db, """
        SELECT b.id AS bid_id, u.full_name AS provider_name,
               b.amount, b.estimated_days, b.work_days_csv AS work_days,
               b.status, b.created_at AS submitted_at
        FROM bids b
        JOIN users u ON u.id = b.provider_id
        WHERE b.request_id = :rid
        ORDER BY b.amount ASC
    """, {"rid": poll["service_request_id"]})
    for r in rows:
        r["submitted_at"] = str(r["submitted_at"])
        r["work_days"] = r.get("work_days") or ""
    return rows
