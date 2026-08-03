import json
import os
import re
from datetime import datetime, timedelta, timezone
from datetime import date as date_type
from typing import Optional
from math import asin, cos, radians, sin, sqrt

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from dependencies import get_current_user, get_db
from models.ai_memory import AIMemory
from models.bid import Bid
from models.message import Conversation, GroupChannel, Message
from models.provider_profile import ProviderProfile
from models.request import ServiceRequest
from models.review import Review
from models.schedule_item import ScheduleItem as ScheduleItemModel
from models.user import User
from services.group_alert_cron import run_group_alerts
from services.group_cron import run_group_cron
from services.recommender import _provider_stats, suggest_bid_price
from schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    AIMemoryOut,
    BidDrafterRequest,
    BidDrafterResponse,
    DemandForecastResponse,
    DemandPrediction,
    DisputeRequest,
    DisputeResponse,
    DisputeResolutionOption,
    QuoteSummaryResponse,
    QuoteSummaryVsNeighBid,
    RequestWriterRequest,
    RequestWriterResponse,
    SmartScheduleItem,
    SmartScheduleResponse,
)

router = APIRouter(prefix="/ai", tags=["ai"])

MEMORY_WINDOW = 20


def _distance_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_mi = 3958.8
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    c = 2 * asin(sqrt(a))
    return earth_radius_mi * c


def _build_quote_summary(
    *,
    quote_text: str,
    request_id: Optional[int],
    db: Session,
    current_user: User,
) -> QuoteSummaryResponse:
    if current_user.role != "homeowner":
        raise HTTPException(status_code=403, detail="Homeowner role required")

    def _stub_response() -> QuoteSummaryResponse:
        return QuoteSummaryResponse(
            provider_name="Unknown Provider",
            quoted_amount=0,
            scope_summary="Could not extract quote details",
            flags=[],
            score=0,
            recommendation="Upload a clearer PDF or image",
            stub=True,
        )

    vs_data = None
    if request_id:
        req = db.query(ServiceRequest).filter(ServiceRequest.id == request_id).first()
        if req:
            best_bid = (
                db.query(Bid)
                .filter(Bid.request_id == request_id, Bid.status == "pending")
                .order_by(Bid.amount)
                .first()
            )
            if best_bid:
                vs_data = {"request": req, "best_bid": best_bid}

    system_prompt = (
        "You are a home-services quote analyser for BidBundle.\n"
        "Analyse the provided quote text and return ONLY a JSON object - no markdown, "
        "no explanation.\n\n"
        "Return this exact shape:\n"
        "{\n"
        '  "provider_name": "<company name from quote, or \'Unknown Provider\'>",\n'
        '  "quoted_amount_cents": <integer - dollar amount x 100, or 0 if not found>,\n'
        '  "scope_summary": "<1-2 sentence plain-English summary of what is included>",\n'
        '  "flags": ["<issue 1>", "<issue 2>"],\n'
        '  "score": <integer 0-100 - overall quote quality>,\n'
        '  "recommendation": "<1 sentence actionable recommendation>"\n'
        "}"
    )

    if not quote_text.strip():
        return _stub_response()

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _stub_response()

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Quote text:\n\n{quote_text[:4000]}"},
            ],
            temperature=0.3,
            max_tokens=512,
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
    except Exception:
        return _stub_response()

    try:
        quoted_amount = int(parsed.get("quoted_amount_cents", 0) or 0)
    except (TypeError, ValueError):
        quoted_amount = 0

    provider_name = str(parsed.get("provider_name") or "Unknown Provider")
    scope_summary = str(parsed.get("scope_summary") or "Could not extract quote details")
    raw_flags = parsed.get("flags")
    flags = [str(flag) for flag in raw_flags[:4]] if isinstance(raw_flags, list) else []
    try:
        score = int(parsed.get("score", 0) or 0)
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    recommendation = str(parsed.get("recommendation") or "Upload a clearer PDF or image")

    vs_neighbid = None
    if vs_data and quoted_amount > 0:
        saving = quoted_amount - vs_data["best_bid"].amount
        vs_neighbid = QuoteSummaryVsNeighBid(
            neighbid_best_bid=vs_data["best_bid"].amount,
            saving_if_use_neighbid=saving,
            neighbid_has_warranty=False,
        )
        if saving > 0:
            recommendation += f" BidBundle's best bid saves you ${saving // 100} vs this quote."
        elif saving < 0:
            recommendation += (
                f" This quote is ${abs(saving) // 100} cheaper than BidBundle's best."
            )

    return QuoteSummaryResponse(
        provider_name=provider_name,
        quoted_amount=quoted_amount,
        scope_summary=scope_summary,
        flags=flags,
        vs_neighbid=vs_neighbid,
        score=score,
        recommendation=recommendation,
        stub=False,
    )


def _quote_summary_stub() -> QuoteSummaryResponse:
    return QuoteSummaryResponse(
        provider_name="Unknown Provider",
        quoted_amount=0,
        scope_summary="Could not extract quote details",
        flags=[],
        score=0,
        recommendation="Upload a clearer PDF or image",
        stub=True,
    )


def _finalize_quote_summary_from_parsed(
    *,
    parsed: dict,
    request_id: Optional[int],
    db: Session,
) -> QuoteSummaryResponse:
    vs_data = None
    if request_id:
        req = db.query(ServiceRequest).filter(ServiceRequest.id == request_id).first()
        if req:
            best_bid = (
                db.query(Bid)
                .filter(Bid.request_id == request_id, Bid.status == "pending")
                .order_by(Bid.amount)
                .first()
            )
            if best_bid:
                vs_data = {"request": req, "best_bid": best_bid}

    try:
        quoted_amount = int(parsed.get("quoted_amount_cents", 0) or 0)
    except (TypeError, ValueError):
        quoted_amount = 0

    provider_name = str(parsed.get("provider_name") or "Unknown Provider")
    scope_summary = str(parsed.get("scope_summary") or "Could not extract quote details")
    raw_flags = parsed.get("flags")
    flags = [str(flag) for flag in raw_flags[:4]] if isinstance(raw_flags, list) else []
    try:
        score = int(parsed.get("score", 0) or 0)
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    recommendation = str(parsed.get("recommendation") or "Upload a clearer PDF or image")

    vs_neighbid = None
    if vs_data and quoted_amount > 0:
        saving = quoted_amount - vs_data["best_bid"].amount
        vs_neighbid = QuoteSummaryVsNeighBid(
            neighbid_best_bid=vs_data["best_bid"].amount,
            saving_if_use_neighbid=saving,
            neighbid_has_warranty=False,
        )
        if saving > 0:
            recommendation += f" BidBundle's best bid saves you ${saving // 100} vs this quote."
        elif saving < 0:
            recommendation += (
                f" This quote is ${abs(saving) // 100} cheaper than BidBundle's best."
            )

    return QuoteSummaryResponse(
        provider_name=provider_name,
        quoted_amount=quoted_amount,
        scope_summary=scope_summary,
        flags=flags,
        vs_neighbid=vs_neighbid,
        score=score,
        recommendation=recommendation,
        stub=False,
    )


@router.post("/run-group-alerts")
def run_group_alerts_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger the group alert cron. Any authenticated user can call this for testing."""
    count = run_group_alerts(db)
    return {"created": count}


@router.post("/run-group-cron")
def run_group_cron_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger the group-phase cron manually. Any authenticated user can call this for testing."""
    result = run_group_cron(db)
    return result


def _build_system_prompt(db: Session, user: User, context_key: str) -> str:
    """Assemble a system prompt with live DB context for the current user."""
    lines = [
        "You are BidBundle AI - a friendly, concise assistant built into a community "
        "home-services bidding platform called BidBundle.",
        "",
        "BidBundle lets neighbours group home-service requests so providers compete for "
        "the whole block, giving everyone group pricing instead of solo quotes.",
        "",
        "=== Current user ===",
        f"Name: {user.full_name}",
        f"Role: {user.role}",
        f"Neighborhood: {user.neighborhood or 'not set'}",
    ]

    if user.role == "homeowner":
        requests = (
            db.query(ServiceRequest)
            .filter(ServiceRequest.user_id == user.id)
            .order_by(ServiceRequest.created_at.desc())
            .limit(5)
            .all()
        )
        if requests:
            lines += ["", "=== Active service requests ==="]
            for req in requests:
                bids = db.query(Bid).filter(Bid.request_id == req.id).all()
                best = min((b.amount for b in bids if b.status == "pending"), default=None)
                lines.append(
                    f"- [{req.id}] {req.title} | status={req.status} | "
                    f"budget=${req.budget_min//100}-{req.budget_max//100} | "
                    f"bids={len(bids)}"
                    + (f" | best_bid=${best//100}" if best else "")
                )

    if user.role == "provider":
        bids = (
            db.query(Bid)
            .filter(Bid.provider_id == user.id)
            .order_by(Bid.created_at.desc())
            .limit(5)
            .all()
        )
        if bids:
            lines += ["", "=== Recent bids ==="]
            for bid in bids:
                req = db.query(ServiceRequest).filter(ServiceRequest.id == bid.request_id).first()
                lines.append(
                    f"- bid #{bid.id} | {req.title if req else '?'} | "
                    f"${bid.amount//100} | {bid.status}"
                )

    if context_key.startswith("group:"):
        try:
            channel_id = int(context_key.split(":")[1])
        except ValueError:
            channel_id = None

        if channel_id:
            channel = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
            if channel:
                req = db.query(ServiceRequest).filter(
                    ServiceRequest.id == channel.request_id
                ).first()
                if req:
                    bids = db.query(Bid).filter(Bid.request_id == req.id).all()
                    lines += [
                        "",
                        "=== This group bid channel ===",
                        f"Request: {req.title}",
                        f"Neighborhood: {req.neighborhood}",
                        f"Budget: ${req.budget_min//100}-{req.budget_max//100}",
                        f"Status: {req.status}",
                    ]
                    if bids:
                        lines.append("Bids received:")
                        for bid in bids:
                            provider = db.query(User).filter(User.id == bid.provider_id).first()
                            lines.append(
                                f"  - {provider.full_name if provider else 'Unknown'}: "
                                f"${bid.amount//100} / {bid.estimated_days}d / status={bid.status}"
                            )

                recent_msgs = (
                    db.query(Message)
                    .filter(Message.channel_id == channel_id)
                    .order_by(Message.created_at.desc())
                    .limit(5)
                    .all()
                )
                if recent_msgs:
                    lines += ["", "=== Recent group messages ==="]
                    for message in reversed(recent_msgs):
                        sender = db.query(User).filter(User.id == message.sender_id).first()
                        lines.append(
                            f"{sender.full_name if sender else 'User'}: {message.text}"
                        )

    lines += [
        "",
        "=== Your capabilities ===",
        "You are an agentic AI assistant. You can take real actions using tools.",
    ]

    if user.role == "homeowner":
        lines += [
            "Tools available: get_my_requests, get_bids_for_request, create_service_request, accept_bid, decline_bid.",
            "",
            "=== Behaviour rules ===",
            "1. Detect intent first — understand what the user wants before acting.",
            "2. For CREATE: collect title, service type, description, and rough budget conversationally before calling create_service_request. Confirm with the user before creating.",
            "3. For ACCEPT/DECLINE: always call get_bids_for_request first so you can name the provider and amount. Ask for confirmation before accepting or declining.",
            "4. For BROWSE: call get_my_requests or get_bids_for_request proactively when the user asks about their requests or bids.",
            "5. Be concise. Use real data from tools — never invent prices or provider names.",
            "6. After taking an action (create, accept, decline), tell the user exactly what was done.",
            "7. If you need more info to complete an action, ask — don't guess.",
        ]
    elif user.role == "provider":
        lines += [
            "Tools available: get_my_provider_bids, get_nearby_provider_jobs, get_provider_profile_summary.",
            "",
            "=== Behaviour rules ===",
            "1. Detect provider intent first — understand whether the provider wants nearby work, bid help, pricing help, or schedule help.",
            "2. For nearby-job or what-should-I-focus-on questions, call get_nearby_provider_jobs before answering.",
            "3. For bid-status or pipeline questions, call get_my_provider_bids before answering.",
            "4. For service-area, radius, or business-context questions, call get_provider_profile_summary before answering.",
            "5. Be concise. Use real data from tools — never invent jobs, distances, or bid counts.",
            "6. If a tool returns no data, say that clearly and offer the next-best action.",
        ]
    else:
        lines += [
            "Use the conversation context and any available data conservatively. If you cannot verify something, say so plainly.",
        ]

    return "\n".join(lines)


def _load_memory(db: Session, user_id: int, context_key: str) -> list[dict]:
    """Load last MEMORY_WINDOW messages for this user+context as OpenAI message dicts."""
    rows = (
        db.query(AIMemory)
        .filter(AIMemory.user_id == user_id, AIMemory.context_key == context_key)
        .order_by(AIMemory.created_at.desc())
        .limit(MEMORY_WINDOW)
        .all()
    )
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def _save_memory(db: Session, user_id: int, context_key: str, role: str, content: str) -> None:
    memory = AIMemory(user_id=user_id, context_key=context_key, role=role, content=content)
    db.add(memory)
    db.commit()

    total = (
        db.query(func.count(AIMemory.id))
        .filter(AIMemory.user_id == user_id, AIMemory.context_key == context_key)
        .scalar()
        or 0
    )
    if total > MEMORY_WINDOW * 2:
        oldest = (
            db.query(AIMemory)
            .filter(AIMemory.user_id == user_id, AIMemory.context_key == context_key)
            .order_by(AIMemory.created_at)
            .limit(total - MEMORY_WINDOW * 2)
            .all()
        )
        for row in oldest:
            db.delete(row)
        db.commit()


HOMEOWNER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_requests",
            "description": "Fetch all service requests belonging to the current homeowner.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_bids_for_request",
            "description": "Fetch all bids for a specific service request owned by the homeowner.",
            "parameters": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "integer", "description": "The service request ID"}
                },
                "required": ["request_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_service_request",
            "description": "Create a new service request for the homeowner after collecting all required details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short descriptive title"},
                    "description": {"type": "string", "description": "Detailed description of the work needed"},
                    "category": {
                        "type": "string",
                        "enum": ["plumbing", "lawn", "gutter", "hvac", "electrical", "cleaning", "handyman", "roofing", "other"],
                    },
                    "budget_min_cents": {"type": "integer", "description": "Minimum budget in cents (e.g. 30000 = $300)"},
                    "budget_max_cents": {"type": "integer", "description": "Maximum budget in cents"},
                },
                "required": ["title", "description", "category", "budget_min_cents", "budget_max_cents"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "accept_bid",
            "description": "Accept a bid on behalf of the homeowner. Must confirm with user first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bid_id": {"type": "integer", "description": "The bid ID to accept"}
                },
                "required": ["bid_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "decline_bid",
            "description": "Decline a bid on behalf of the homeowner.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bid_id": {"type": "integer", "description": "The bid ID to decline"}
                },
                "required": ["bid_id"],
            },
        },
    },
]


PROVIDER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_provider_bids",
            "description": "Fetch the provider's latest bids and their statuses.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_nearby_provider_jobs",
            "description": "Fetch nearby live or grouping homeowner requests within the provider's service radius.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of nearby jobs to return",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_provider_profile_summary",
            "description": "Fetch the provider's business profile, service area, and radius.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


def _execute_tool(tool_name: str, args: dict, db: Session, user: User) -> str:
    """Execute a tool call and return the result as a JSON string."""
    try:
        if tool_name == "get_my_requests":
            requests = (
                db.query(ServiceRequest)
                .filter(ServiceRequest.user_id == user.id)
                .order_by(ServiceRequest.created_at.desc())
                .limit(10)
                .all()
            )
            return json.dumps([
                {
                    "id": r.id,
                    "title": r.title,
                    "category": r.category,
                    "status": r.status,
                    "neighborhood": r.neighborhood,
                    "budget": f"${r.budget_min // 100}–${r.budget_max // 100}",
                    "bid_count": len(r.bids),
                }
                for r in requests
            ])

        elif tool_name == "get_bids_for_request":
            request_id = int(args["request_id"])
            req = db.query(ServiceRequest).filter(
                ServiceRequest.id == request_id,
                ServiceRequest.user_id == user.id,
            ).first()
            if not req:
                return json.dumps({"error": "Request not found or not yours"})
            bids = db.query(Bid).filter(Bid.request_id == request_id).all()
            result = []
            for bid in bids:
                provider = db.query(User).filter(User.id == bid.provider_id).first()
                result.append({
                    "bid_id": bid.id,
                    "provider": provider.full_name if provider else "Unknown",
                    "amount": f"${bid.amount // 100}",
                    "estimated_days": bid.estimated_days,
                    "status": bid.status,
                })
            return json.dumps({"request": req.title, "bids": result})

        elif tool_name == "create_service_request":
            new_req = ServiceRequest(
                user_id=user.id,
                title=args["title"],
                description=args["description"],
                category=args["category"],
                neighborhood=user.neighborhood or "Oakwood Heights",
                budget_min=int(args["budget_min_cents"]),
                budget_max=int(args["budget_max_cents"]),
                status="draft",
            )
            db.add(new_req)
            db.commit()
            db.refresh(new_req)
            return json.dumps({
                "success": True,
                "request_id": new_req.id,
                "title": new_req.title,
                "category": new_req.category,
                "budget": f"${new_req.budget_min // 100}–${new_req.budget_max // 100}",
                "status": new_req.status,
            })

        elif tool_name == "accept_bid":
            bid_id = int(args["bid_id"])
            bid = db.query(Bid).filter(Bid.id == bid_id).first()
            if not bid:
                return json.dumps({"error": "Bid not found"})
            req = db.query(ServiceRequest).filter(
                ServiceRequest.id == bid.request_id,
                ServiceRequest.user_id == user.id,
            ).first()
            if not req:
                return json.dumps({"error": "Not authorised to accept this bid"})
            bid.status = "accepted"
            db.commit()
            provider = db.query(User).filter(User.id == bid.provider_id).first()
            return json.dumps({
                "success": True,
                "bid_id": bid.id,
                "provider": provider.full_name if provider else "Unknown",
                "amount": f"${bid.amount // 100}",
                "status": "accepted",
            })

        elif tool_name == "decline_bid":
            bid_id = int(args["bid_id"])
            bid = db.query(Bid).filter(Bid.id == bid_id).first()
            if not bid:
                return json.dumps({"error": "Bid not found"})
            req = db.query(ServiceRequest).filter(
                ServiceRequest.id == bid.request_id,
                ServiceRequest.user_id == user.id,
            ).first()
            if not req:
                return json.dumps({"error": "Not authorised"})
            bid.status = "declined"
            db.commit()
            return json.dumps({"success": True, "bid_id": bid.id, "status": "declined"})

        elif tool_name == "get_my_provider_bids":
            provider_bids = (
                db.query(Bid, ServiceRequest)
                .join(ServiceRequest, Bid.request_id == ServiceRequest.id)
                .filter(Bid.provider_id == user.id)
                .order_by(Bid.created_at.desc())
                .limit(10)
                .all()
            )
            latest_by_request: dict[int, dict] = {}
            for bid, request in provider_bids:
                latest_by_request[request.id] = {
                    "bid_id": bid.id,
                    "request_id": request.id,
                    "title": request.title,
                    "category": request.category,
                    "neighborhood": request.neighborhood,
                    "amount": f"${bid.amount // 100}",
                    "estimated_days": bid.estimated_days,
                    "status": bid.status,
                    "request_status": request.status,
                }
            return json.dumps(list(latest_by_request.values()))

        elif tool_name == "get_provider_profile_summary":
            profile = db.query(ProviderProfile).filter(ProviderProfile.user_id == user.id).first()
            return json.dumps({
                "company_name": profile.company_name if profile else None,
                "neighborhood": (profile.neighborhood if profile and profile.neighborhood else user.neighborhood),
                "address": (profile.address if profile and profile.address else user.address),
                "service_radius_mi": profile.service_radius_mi if profile else None,
                "trades": profile.trades.split(",") if profile and profile.trades else [],
                "is_insured": profile.is_insured if profile else False,
                "is_licensed": profile.is_licensed if profile else False,
            })

        elif tool_name == "get_nearby_provider_jobs":
            profile = db.query(ProviderProfile).filter(ProviderProfile.user_id == user.id).first()
            radius_mi = profile.service_radius_mi if profile and profile.service_radius_mi else 4
            limit = max(1, min(int(args.get("limit", 5)), 10))

            requests = (
                db.query(ServiceRequest)
                .filter(ServiceRequest.status.in_(["live", "grouping"]))
                .order_by(ServiceRequest.created_at.desc())
                .all()
            )
            rows: list[dict] = []
            for request in requests:
                owner = db.query(User).filter(User.id == request.user_id).first()
                distance = None
                if (
                    user.latitude is not None
                    and user.longitude is not None
                    and owner is not None
                    and owner.latitude is not None
                    and owner.longitude is not None
                ):
                    distance = round(
                        _distance_mi(user.latitude, user.longitude, owner.latitude, owner.longitude),
                        1,
                    )
                    if distance > radius_mi:
                        continue
                bid_count = db.query(func.count(Bid.id)).filter(Bid.request_id == request.id).scalar() or 0
                rows.append({
                    "request_id": request.id,
                    "title": request.title,
                    "category": request.category,
                    "neighborhood": request.neighborhood,
                    "status": request.status,
                    "budget": f"${request.budget_min // 100}-${request.budget_max // 100}",
                    "distance_mi": distance,
                    "provider_bid_count": bid_count,
                    "closes_at": request.closes_at.isoformat() if request.closes_at else None,
                })
            rows.sort(
                key=lambda row: (
                    row["distance_mi"] is None,
                    row["distance_mi"] if row["distance_mi"] is not None else float("inf"),
                    -row["provider_bid_count"],
                )
            )
            return json.dumps(rows[:limit])

        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    except Exception as exc:
        return json.dumps({"error": str(exc)})


def _call_openai(
    system_prompt: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> tuple[str, Optional[int]]:
    """
    Call OpenAI chat completions. Returns (reply_text, tokens_used).
    Raises RuntimeError if the API key is missing.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=full_messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    reply = response.choices[0].message.content or ""
    tokens = response.usage.total_tokens if response.usage else None
    return reply, tokens


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(
    payload: AIChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AIChatResponse:
    """Agentic AI assistant with tool use, per-user memory, and real DB actions."""
    context_key = payload.context_key
    system_prompt = _build_system_prompt(db, current_user, context_key)
    history = _load_memory(db, current_user.id, context_key)

    _save_memory(db, current_user.id, context_key, "user", payload.message)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        stub_reply = (
            "BidBundle AI is not configured yet — add OPENAI_API_KEY to api/.env "
            "and restart the server."
        )
        _save_memory(db, current_user.id, context_key, "assistant", stub_reply)
        return AIChatResponse(reply=stub_reply, context_key=context_key, stub=True)

    if current_user.role == "homeowner":
        tools = HOMEOWNER_TOOLS
    elif current_user.role == "provider":
        tools = PROVIDER_TOOLS
    else:
        tools = []

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        # Build message list: system + history + new user message
        messages: list = [{"role": "system", "content": system_prompt}] + history
        messages.append({"role": "user", "content": payload.message})

        reply = ""
        tokens_used = None

        # Tool-calling loop — max 5 iterations to avoid runaway loops
        for _ in range(5):
            kwargs: dict = {
                "model": "gpt-4o-mini",
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 600,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"

            response = client.chat.completions.create(**kwargs)
            choice = response.choices[0]
            tokens_used = response.usage.total_tokens if response.usage else None

            if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
                # Append assistant message with tool_calls
                messages.append(choice.message)

                # Execute each requested tool and append results
                for tc in choice.message.tool_calls:
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except (json.JSONDecodeError, ValueError):
                        tool_args = {}

                    result = _execute_tool(tc.function.name, tool_args, db, current_user)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })
                # Loop back so GPT can synthesise the tool results into a reply
                continue

            # Non-tool response — we have the final reply
            reply = choice.message.content or ""
            break
        else:
            reply = "I wasn't able to complete that request. Please try again."

    except Exception:
        reply = "BidBundle AI encountered an error. Please try again in a moment."
        _save_memory(db, current_user.id, context_key, "assistant", reply)
        return AIChatResponse(reply=reply, context_key=context_key, stub=True)

    _save_memory(db, current_user.id, context_key, "assistant", reply)

    return AIChatResponse(
        reply=reply,
        context_key=context_key,
        tokens_used=tokens_used,
        stub=False,
    )


@router.post("/group/{channel_id}", response_model=AIChatResponse)
def ai_group_chat(
    channel_id: int,
    payload: AIChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AIChatResponse:
    """
    AI triggered inside a group bid channel.
    Validates membership, uses channel-scoped memory, and posts the reply to the channel.
    """
    channel = db.query(GroupChannel).filter(GroupChannel.id == channel_id).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    req = db.query(ServiceRequest).filter(ServiceRequest.id == channel.request_id).first()
    is_homeowner_owner = req is not None and req.user_id == current_user.id
    is_provider_bidder = (
        db.query(Bid)
        .filter(
            Bid.request_id == channel.request_id,
            Bid.provider_id == current_user.id,
        )
        .first()
        is not None
    )
    if not (is_homeowner_owner or is_provider_bidder):
        raise HTTPException(status_code=403, detail="Not a channel participant")

    context_key = f"group:{channel_id}"
    payload.context_key = context_key

    system_prompt = _build_system_prompt(db, current_user, context_key)
    history = _load_memory(db, current_user.id, context_key)
    _save_memory(db, current_user.id, context_key, "user", payload.message)
    history.append({"role": "user", "content": payload.message})

    try:
        reply, tokens = _call_openai(system_prompt, history)
        stub = False
    except Exception:
        reply = (
            "BidBundle AI is not configured yet - add OPENAI_API_KEY to api/.env "
            "and restart the server."
        )
        tokens = None
        stub = True

    _save_memory(db, current_user.id, context_key, "assistant", reply)

    ai_message = Message(
        sender_id=current_user.id,
        channel_id=channel_id,
        text=f"[BidBundle AI] {reply}",
    )
    db.add(ai_message)
    db.commit()

    return AIChatResponse(
        reply=reply,
        context_key=context_key,
        tokens_used=tokens,
        stub=stub,
    )


@router.get("/history", response_model=list[AIMemoryOut])
def get_history(
    context_key: str = "general",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AIMemoryOut]:
    """Return conversation history for the current user and context."""
    return (
        db.query(AIMemory)
        .filter(
            AIMemory.user_id == current_user.id,
            AIMemory.context_key == context_key,
        )
        .order_by(AIMemory.created_at)
        .all()
    )


@router.delete("/memory", status_code=204)
def clear_memory(
    context_key: str = "general",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete all AI memory for this user and context."""
    db.query(AIMemory).filter(
        AIMemory.user_id == current_user.id,
        AIMemory.context_key == context_key,
    ).delete()
    db.commit()


REQUEST_WRITER_CATEGORY_PATTERNS = [
    ("plumbing", r"leak|pipe|drain|faucet|sink|toilet|water heater"),
    ("lawn", r"lawn|grass|mow|garden|landscap|trim|hedge|sprinkler"),
    ("gutter", r"gutter|downspout|fascia"),
    ("hvac", r"hvac|heat|furnace|ac|air condition|duct|thermostat"),
    ("electrical", r"electric|wiring|outlet|breaker|panel|light fixture"),
    ("cleaning", r"clean|sweep|dust|vacuum|pressure wash|window clean"),
    ("handyman", r"handyman|paint|drywall|door|fence|deck|tile"),
    ("roofing", r"roof|shingle|flashing|leak.*roof"),
]

CATEGORY_BUDGET_DEFAULTS = {
    "plumbing": (25000, 75000),
    "lawn": (8000, 25000),
    "gutter": (15000, 45000),
    "hvac": (50000, 150000),
    "electrical": (30000, 90000),
    "cleaning": (8000, 20000),
    "handyman": (10000, 40000),
    "roofing": (40000, 200000),
    "other": (10000, 50000),
}


def _guess_request_writer_category(description: str) -> str:
    text = description.lower()
    for category, pattern in REQUEST_WRITER_CATEGORY_PATTERNS:
        if re.search(pattern, text):
            return category
    return "other"


def _percentile(values: list[int], percentile: float) -> int:
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]

    rank = (len(sorted_values) - 1) * percentile
    lower_index = int(rank)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    weight = rank - lower_index
    return int(
        round(
            sorted_values[lower_index]
            + (sorted_values[upper_index] - sorted_values[lower_index]) * weight
        )
    )


def _build_request_writer_stub(
    description: str,
    guessed_category: str,
    budget_min: int,
    budget_max: int,
    estimated_group_likelihood: str,
    group_reason: str,
) -> RequestWriterResponse:
    return RequestWriterResponse(
        title=description.strip()[:60] or "Service request",
        category=guessed_category,
        description=description.strip(),
        budget_min=budget_min,
        budget_max=budget_max,
        estimated_group_likelihood=estimated_group_likelihood,
        group_reason=group_reason,
        stub=True,
    )


@router.post("/request-writer", response_model=RequestWriterResponse)
def request_writer(
    payload: RequestWriterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RequestWriterResponse:
    guessed_category = _guess_request_writer_category(payload.description)

    accepted_bids = (
        db.query(Bid.amount)
        .join(ServiceRequest, Bid.request_id == ServiceRequest.id)
        .filter(
            ServiceRequest.category == guessed_category,
            Bid.status == "accepted",
        )
        .all()
    )
    accepted_amounts = [amount for (amount,) in accepted_bids]

    if len(accepted_amounts) >= 3:
        budget_min = _percentile(accepted_amounts, 0.25)
        budget_max = _percentile(accepted_amounts, 0.75)
    else:
        budget_min, budget_max = CATEGORY_BUDGET_DEFAULTS[guessed_category]

    user_neighborhood = current_user.neighborhood or "Oakwood Heights"
    group_count = (
        db.query(func.count(ServiceRequest.id))
        .filter(
            ServiceRequest.category == guessed_category,
            ServiceRequest.neighborhood == user_neighborhood,
            ServiceRequest.status.in_(["live", "grouping"]),
        )
        .scalar()
        or 0
    )

    if group_count >= 3:
        estimated_group_likelihood = "high"
        group_reason = (
            f"{group_count} similar {guessed_category} requests active in "
            f"{user_neighborhood} this week"
        )
    elif group_count >= 1:
        estimated_group_likelihood = "medium"
        group_reason = f"{group_count} neighbor also requested {guessed_category} recently"
    else:
        estimated_group_likelihood = "low"
        group_reason = "No active group for this service — your request will start one"

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _build_request_writer_stub(
            description=payload.description,
            guessed_category=guessed_category,
            budget_min=budget_min,
            budget_max=budget_max,
            estimated_group_likelihood=estimated_group_likelihood,
            group_reason=group_reason,
        )

    system_prompt = (
        "You are a professional home-services request writer for BidBundle.\n"
        "Your job: take a homeowner's plain-language problem description and return ONLY "
        "a JSON object — no markdown, no explanation, just raw JSON.\n\n"
        "Category taxonomy (use exactly): plumbing, lawn, gutter, hvac, electrical, "
        "cleaning, handyman, roofing, other\n"
        f"Detected category: {guessed_category}\n\n"
        "Return this exact shape:\n"
        "{\n"
        '  "title": "<concise, professional title, max 10 words>",\n'
        '  "category": "<category from taxonomy>",\n'
        '  "description": "<professional rewrite of the problem, 2-3 sentences, include what needs to be done>"\n'
        "}"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": payload.description},
            ],
            temperature=0.4,
            max_tokens=300,
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
    except Exception:
        return _build_request_writer_stub(
            description=payload.description,
            guessed_category=guessed_category,
            budget_min=budget_min,
            budget_max=budget_max,
            estimated_group_likelihood=estimated_group_likelihood,
            group_reason=group_reason,
        )

    return RequestWriterResponse(
        title=parsed.get("title") or payload.description.strip()[:60] or "Service request",
        category=parsed.get("category") or guessed_category,
        description=parsed.get("description") or payload.description.strip(),
        budget_min=budget_min,
        budget_max=budget_max,
        estimated_group_likelihood=estimated_group_likelihood,
        group_reason=group_reason,
        stub=False,
    )


@router.post("/bid-drafter", response_model=BidDrafterResponse)
def bid_drafter(
    payload: BidDrafterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BidDrafterResponse:
    if current_user.role != "provider":
        raise HTTPException(status_code=403, detail="Provider role required")

    req = db.query(ServiceRequest).filter(ServiceRequest.id == payload.request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    price_data = suggest_bid_price(db, payload.request_id)
    suggested_low = price_data.get("suggested_low_cents", req.budget_min)
    suggested_high = price_data.get("suggested_high_cents", req.budget_max)
    suggested_amount = (suggested_low + suggested_high) // 2
    confidence = price_data.get("confidence", "low")

    profile = db.query(ProviderProfile).filter(
        ProviderProfile.user_id == current_user.id
    ).first()
    stats = _provider_stats(db, current_user.id)

    parts = []
    if profile and profile.is_licensed:
        parts.append("Licensed")
    if profile and profile.is_insured:
        parts.append("Insured")
    if stats.get("avg_rating"):
        parts.append(f"{stats['avg_rating']}★ avg rating")
    parts.append("2-day turnaround")
    headline = " · ".join(parts) if parts else "Professional · Reliable"

    bid_count = db.query(Bid).filter(Bid.request_id == payload.request_id).count()
    fallback_text = (
        f"We propose ${suggested_amount // 100} for {req.title}. "
        "Our team will complete the work within 2 days."
    )

    system_prompt = (
        "You are a professional bid writer for BidBundle, a group home-services bidding "
        "platform.\n"
        "Write a short, professional bid proposal for a service provider.\n"
        "Return ONLY a JSON object — no markdown, no explanation.\n\n"
        "Shape:\n"
        "{\n"
        '  "draft_text": "<2-3 sentence proposal. Mention the job scope, the price, and '
        'the estimated days.>",\n'
        '  "suggested_days": <integer, 1-14>\n'
        "}"
    )
    user_message = (
        f"Job title: {req.title}\n"
        f"Category: {req.category}\n"
        f"Neighborhood: {req.neighborhood}\n"
        f"Job description: {req.description}\n"
        f"Number of homes in group: {bid_count}\n"
        f"Provider company: {profile.company_name if profile and profile.company_name else current_user.full_name}\n"
        f"Provider trades: {profile.trades if profile and profile.trades else 'general'}\n"
        f"Suggested price: ${suggested_amount // 100}\n"
        f"Provider rating: {stats.get('avg_rating') or 'new provider'}\n"
        f"Provider win rate: {stats.get('win_rate') or 'new provider'}"
    )

    try:
        reply, _ = _call_openai(
            system_prompt,
            [{"role": "user", "content": user_message}],
            temperature=0.5,
            max_tokens=256,
        )
        parsed = json.loads(reply)
    except json.JSONDecodeError:
        parsed = {
            "draft_text": fallback_text,
            "suggested_days": 2,
        }
        return BidDrafterResponse(
            suggested_amount_cents=suggested_amount,
            suggested_days=parsed.get("suggested_days", 2),
            draft_text=parsed.get("draft_text", fallback_text),
            headline=headline,
            confidence=confidence,
            stub=False,
        )
    except Exception:
        return BidDrafterResponse(
            suggested_amount_cents=suggested_amount,
            suggested_days=2,
            draft_text=fallback_text,
            headline=headline,
            confidence=confidence,
            stub=True,
        )

    try:
        suggested_days = int(parsed.get("suggested_days", 2))
    except (TypeError, ValueError):
        suggested_days = 2
    suggested_days = max(1, min(14, suggested_days))

    return BidDrafterResponse(
        suggested_amount_cents=suggested_amount,
        suggested_days=suggested_days,
        draft_text=parsed.get("draft_text", fallback_text),
        headline=headline,
        confidence=confidence,
        stub=False,
    )


@router.post("/quote-summary", response_model=QuoteSummaryResponse)
async def quote_summary(
    file: UploadFile = File(...),
    request_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> QuoteSummaryResponse:
    import io

    file_bytes = await file.read()
    content_type = file.content_type or ""
    filename = (file.filename or "").lower()

    if "pdf" in content_type or filename.endswith(".pdf"):
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(file_bytes))
            extracted_text = "\n".join(
                page.extract_text() or "" for page in reader.pages
            ).strip()
        except Exception:
            extracted_text = ""
    else:
        extracted_text = ""

    if not extracted_text and not content_type.startswith("image/"):
        return _quote_summary_stub()

    try:
        if extracted_text:
            return _build_quote_summary(
                quote_text=extracted_text,
                request_id=request_id,
                db=db,
                current_user=current_user,
            )
    except Exception:
        return _quote_summary_stub()

    try:
        from openai import OpenAI
        import base64

        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return _quote_summary_stub()

        system_prompt = (
            "You are a home-services quote analyser for BidBundle.\n"
            "Analyse the provided quote text and return ONLY a JSON object - no markdown, "
            "no explanation.\n\n"
            "Return this exact shape:\n"
            "{\n"
            '  "provider_name": "<company name from quote, or \'Unknown Provider\'>",\n'
            '  "quoted_amount_cents": <integer - dollar amount x 100, or 0 if not found>,\n'
            '  "scope_summary": "<1-2 sentence plain-English summary of what is included>",\n'
            '  "flags": ["<issue 1>", "<issue 2>"],\n'
            '  "score": <integer 0-100 - overall quote quality>,\n'
            '  "recommendation": "<1 sentence actionable recommendation>"\n'
            "}"
        )
        client = OpenAI(api_key=api_key)
        b64 = base64.b64encode(file_bytes).decode()
        mime = content_type if content_type else "image/jpeg"
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyse this outside provider quote:"},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                },
            ],
            temperature=0.3,
            max_tokens=512,
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        return _finalize_quote_summary_from_parsed(
            parsed=parsed,
            request_id=request_id,
            db=db,
        )
    except Exception:
        return _quote_summary_stub()


class _QuoteSummaryTextRequest(BaseModel):
    quote_text: str
    request_id: Optional[int] = None


@router.post("/quote-summary-text", response_model=QuoteSummaryResponse)
def quote_summary_text(
    payload: _QuoteSummaryTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> QuoteSummaryResponse:
    return _build_quote_summary(
        quote_text=payload.quote_text,
        request_id=payload.request_id,
        db=db,
        current_user=current_user,
    )


class _SmartScheduleRequest(BaseModel):
    date: str


@router.post("/smart-schedule", response_model=SmartScheduleResponse)
def smart_schedule(
    payload: _SmartScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SmartScheduleResponse:
    if current_user.role != "provider":
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        target_date = date_type.fromisoformat(payload.date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid date format — use YYYY-MM-DD") from exc

    accepted_bids = (
        db.query(Bid)
        .filter(Bid.provider_id == current_user.id, Bid.status == "accepted")
        .all()
    )

    existing_items = (
        db.query(ScheduleItemModel)
        .filter(ScheduleItemModel.provider_id == current_user.id)
        .all()
    )
    existing_on_date = [
        item
        for item in existing_items
        if item.scheduled_at and item.scheduled_at.date() == target_date
    ]

    job_lines: list[str] = []
    request_context: dict[int, dict[str, str]] = {}
    total_revenue = 0
    for bid in accepted_bids:
        req = db.query(ServiceRequest).filter(ServiceRequest.id == bid.request_id).first()
        if req:
            total_revenue += bid.amount
            request_context[req.id] = {
                "neighborhood": req.neighborhood,
                "address": f"{req.neighborhood} area",
            }
            job_lines.append(
                f"- Job: {req.title} | Neighborhood: {req.neighborhood} | "
                f"Address: {req.neighborhood} area | "
                f"Duration: 90 min (estimate) | Revenue: ${bid.amount // 100} | "
                f"request_id: {req.id}"
            )

    if not job_lines:
        return SmartScheduleResponse(
            date=payload.date,
            items=[],
            total_hours=0.0,
            estimated_revenue_cents=0,
            conflicts=[],
            stub=True,
        )

    profile = (
        db.query(ProviderProfile)
        .filter(ProviderProfile.user_id == current_user.id)
        .first()
    )
    start_hour = profile.working_hours_start if profile else "07:00"
    end_hour = profile.working_hours_end if profile else "18:00"

    system_prompt = (
        "You are a scheduling assistant for a home-services provider on BidBundle.\n"
        "Optimise their day: cluster jobs in the same neighborhood, minimise travel, fill gaps.\n"
        f"Working hours: {start_hour} – {end_hour}\n"
        f"Date: {payload.date}\n\n"
        "Return ONLY a JSON object — no markdown, no explanation.\n\n"
        "Shape:\n"
        "{\n"
        '  "items": [\n'
        "    {\n"
        '      "title": "<job title>",\n'
        '      "suggested_start": "<HH:MM 24h>",\n'
        '      "duration_minutes": <int>,\n'
        '      "neighborhood": "<neighborhood name>",\n'
        '      "request_id": <int or null>,\n'
        '      "reason": "<1 sentence why this slot>"\n'
        "    }\n"
        "  ],\n"
        '  "conflicts": ["<conflict description>"]\n'
        "}"
    )
    user_message = (
        f"Jobs to schedule on {payload.date}:\n"
        f"{chr(10).join(job_lines)}\n\n"
        f"Existing schedule items on this date:\n"
        f"{chr(10).join(f'- {item.title} at {item.scheduled_at}' for item in existing_on_date) or 'None'}\n\n"
        "Please create an optimised schedule. Cluster same-neighborhood jobs together."
    )

    try:
        content, _ = _call_openai(
            system_prompt=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            temperature=0.3,
            max_tokens=800,
        )
        parsed = json.loads(content)
    except Exception:
        return SmartScheduleResponse(
            date=payload.date,
            items=[],
            total_hours=0.0,
            estimated_revenue_cents=total_revenue,
            conflicts=[],
            stub=True,
        )

    parsed_items: list[SmartScheduleItem] = []
    for raw in parsed.get("items", []):
        if not isinstance(raw, dict):
            continue

        raw_request_id = raw.get("request_id")
        request_id = raw_request_id if isinstance(raw_request_id, int) else None
        request_details = request_context.get(request_id) if request_id is not None else None

        parsed_items.append(
            SmartScheduleItem(
                title=str(raw.get("title", "Job")),
                suggested_start=str(raw.get("suggested_start", "09:00")),
                duration_minutes=int(raw.get("duration_minutes", 90)),
                address=(
                    str(raw.get("address"))
                    if raw.get("address") is not None
                    else (request_details["address"] if request_details else None)
                ),
                neighborhood=str(
                    raw.get("neighborhood")
                    or (request_details["neighborhood"] if request_details else "")
                ),
                request_id=request_id,
                reason=str(raw.get("reason", "")),
            )
        )

    total_hours = sum(item.duration_minutes for item in parsed_items) / 60
    raw_conflicts = parsed.get("conflicts", [])
    conflicts = [str(conflict) for conflict in raw_conflicts] if isinstance(raw_conflicts, list) else []

    return SmartScheduleResponse(
        date=payload.date,
        items=parsed_items,
        total_hours=round(total_hours, 1),
        estimated_revenue_cents=total_revenue,
        conflicts=conflicts,
        stub=False,
    )


@router.post("/dispute/{bid_id}", response_model=DisputeResponse)
def dispute_mediator(
    bid_id: int,
    payload: DisputeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DisputeResponse:
    if current_user.role != "homeowner":
        raise HTTPException(status_code=403, detail="Homeowner role required")

    bid = db.query(Bid).filter(Bid.id == bid_id).first()
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")

    req = db.query(ServiceRequest).filter(ServiceRequest.id == bid.request_id).first()
    if not req or req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your request")

    if bid.status not in ("accepted", "disputed"):
        raise HTTPException(status_code=400, detail="Can only dispute accepted bids")

    bid.status = "disputed"
    db.commit()

    provider = db.query(User).filter(User.id == bid.provider_id).first()
    convo = (
        db.query(Conversation)
        .filter(
            ((Conversation.user_a_id == current_user.id) & (Conversation.user_b_id == bid.provider_id))
            | ((Conversation.user_a_id == bid.provider_id) & (Conversation.user_b_id == current_user.id))
        )
        .first()
    )
    messages = convo.messages[-10:] if convo and convo.messages else []
    review = db.query(Review).filter(Review.bid_id == bid.id).first()

    system_prompt = (
        "You are a neutral dispute mediator for BidBundle, a home-services bidding platform.\n"
        "Read the full context and return ONLY a JSON object - no markdown, no explanation.\n\n"
        "Return this exact shape:\n"
        "{\n"
        '  "summary": "<2-3 sentence factual summary of the situation>",\n'
        "  \"homeowner_position\": \"<1-2 sentences summarising the homeowner's concern>\",\n"
        '  "provider_position": "<1-2 sentences summarising what the provider agreed to do>",\n'
        '  "resolution_options": [\n'
        "    {\n"
        '      "type": "partial_refund",\n'
        '      "description": "<what partial refund would cover and why>",\n'
        '      "amount_cents": <integer or null>\n'
        "    },\n"
        "    {\n"
        '      "type": "revisit",\n'
        '      "description": "<what a revisit would involve>",\n'
        '      "amount_cents": null\n'
        "    },\n"
        "    {\n"
        '      "type": "full_refund",\n'
        '      "description": "<when full refund is warranted>",\n'
        f'      "amount_cents": {bid.amount}\n'
        "    }\n"
        "  ],\n"
        '  "recommendation": "<one of the type values above>",\n'
        '  "confidence": "<high|medium|low>"\n'
        "}"
    )

    msg_lines = [f"  {message.text[:200]}" for message in messages]
    user_message = f"""
Job: {req.title}
Category: {req.category}
Neighborhood: {req.neighborhood}
Original budget: ${req.budget_min//100}-${req.budget_max//100}

Bid accepted: ${bid.amount//100} - {bid.estimated_days} day(s) estimated - status now: disputed
Provider: {provider.full_name if provider else 'Unknown'}

Homeowner complaint: {payload.complaint}

Last {len(messages)} messages between homeowner and provider:
{chr(10).join(msg_lines) if msg_lines else '  (no direct messages)'}

{'Review on file: ' + str(review.stars) + '* - ' + (review.comment or '') if review else 'No review yet.'}
"""

    try:
        reply, _ = _call_openai(
            system_prompt,
            [{"role": "user", "content": user_message}],
            temperature=0.3,
            max_tokens=700,
        )
        parsed = json.loads(reply)
        raw_options = parsed.get("resolution_options")
        if not isinstance(raw_options, list):
            raise ValueError("Missing resolution options")

        options: list[DisputeResolutionOption] = []
        for option in raw_options:
            if not isinstance(option, dict):
                continue

            raw_amount = option.get("amount_cents")
            try:
                amount_cents = int(raw_amount) if raw_amount is not None else None
            except (TypeError, ValueError):
                amount_cents = None

            options.append(
                DisputeResolutionOption(
                    type=str(option.get("type") or "no_action"),
                    description=str(option.get("description") or ""),
                    amount_cents=amount_cents,
                )
            )

        if not options:
            raise ValueError("No valid resolution options")

        return DisputeResponse(
            summary=str(parsed.get("summary") or "Unable to summarise the dispute."),
            homeowner_position=str(parsed.get("homeowner_position") or payload.complaint),
            provider_position=str(
                parsed.get("provider_position")
                or "Provider position could not be determined."
            ),
            resolution_options=options,
            recommendation=str(parsed.get("recommendation") or "revisit"),
            confidence=str(parsed.get("confidence") or "low"),
            stub=False,
        )
    except Exception:
        return DisputeResponse(
            summary="Unable to generate mediation at this time.",
            homeowner_position=payload.complaint,
            provider_position="Provider position could not be determined.",
            resolution_options=[
                DisputeResolutionOption(
                    type="revisit",
                    description="Request a revisit from the provider.",
                ),
                DisputeResolutionOption(
                    type="partial_refund",
                    description="Negotiate a partial refund.",
                    amount_cents=bid.amount // 2,
                ),
            ],
            recommendation="revisit",
            confidence="low",
            stub=True,
        )


def _demand_forecast_stub(neighborhood: str) -> DemandForecastResponse:
    return DemandForecastResponse(
        neighborhood=neighborhood,
        forecast_period="next 30 days",
        predictions=[
            DemandPrediction(
                category="plumbing",
                predicted_requests=6,
                confidence="low",
                reasoning="Historical data unavailable.",
                provider_shortage=False,
                shortage_note="",
            ),
            DemandPrediction(
                category="lawn",
                predicted_requests=4,
                confidence="low",
                reasoning="Seasonal estimate only.",
                provider_shortage=False,
                shortage_note="",
            ),
        ],
        top_opportunity="AI forecasting unavailable — showing estimates.",
        stub=True,
    )


@router.get("/demand-forecast", response_model=DemandForecastResponse)
def demand_forecast(
    neighborhood: str = "Oakwood Heights",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DemandForecastResponse:
    now = datetime.now(timezone.utc)
    window_30 = now - timedelta(days=30)
    window_60 = now - timedelta(days=60)
    window_90 = now - timedelta(days=90)

    def count_requests(since: datetime) -> dict[str, int]:
        rows = (
            db.query(ServiceRequest.category, func.count(ServiceRequest.id))
            .filter(
                ServiceRequest.neighborhood == neighborhood,
                ServiceRequest.created_at >= since.replace(tzinfo=None),
            )
            .group_by(ServiceRequest.category)
            .all()
        )
        return {str(cat): int(cnt) for cat, cnt in rows}

    recent_30 = count_requests(window_30)
    prev_30 = count_requests(window_60)
    prev_60 = count_requests(window_90)

    for cat in list(prev_30.keys()):
        prev_30[cat] = prev_30.get(cat, 0) - prev_60.get(cat, 0)

    all_profiles = db.query(ProviderProfile).all()
    provider_counts: dict[str, int] = {}
    for profile in all_profiles:
        trades_raw = (profile.trades or "").lower()
        trades = [trade.strip() for trade in trades_raw.split(",") if trade.strip()]
        neighborhood_match = (
            not profile.neighborhood
            or profile.neighborhood.lower() == neighborhood.lower()
        )
        if not neighborhood_match:
            continue
        for trade in trades:
            provider_counts[trade] = provider_counts.get(trade, 0) + 1

    lines: list[str] = []
    all_cats = set(recent_30.keys()) | set(prev_30.keys())
    for cat in sorted(all_cats):
        r30 = recent_30.get(cat, 0)
        r_prev = prev_30.get(cat, 0)
        pcount = provider_counts.get(cat, 0)
        trend = "↑" if r30 > r_prev else ("↓" if r30 < r_prev else "→")
        lines.append(
            f"- {cat}: {r30} requests last 30 days (prev 30: {r_prev}) "
            f"{trend} | {pcount} active provider(s)"
        )

    if not lines:
        lines.append("- other: 0 requests last 30 days (prev 30: 0) → | 0 active provider(s)")

    system_prompt = (
        "You are a demand forecasting assistant for BidBundle, a community home-services "
        "platform.\n"
        "Predict the top 4 service categories for the next 30 days in the given "
        "neighborhood.\n"
        "Return ONLY a JSON object — no markdown, no explanation.\n\n"
        "Category taxonomy: plumbing, lawn, gutter, hvac, electrical, cleaning, "
        "handyman, roofing, other\n\n"
        "Shape:\n"
        "{\n"
        '  "predictions": [\n'
        "    {\n"
        '      "category": "<category>",\n'
        '      "predicted_requests": <int 1-20>,\n'
        '      "confidence": "<high|medium|low>",\n'
        '      "reasoning": "<1 sentence>",\n'
        '      "provider_shortage": <bool>,\n'
        '      "shortage_note": "<1 sentence or empty string>"\n'
        "    }\n"
        "  ],\n"
        '  "top_opportunity": "<1 sentence summary of the single best opportunity>"\n'
        "}"
    )
    user_message = (
        f"Neighborhood: {neighborhood}\n"
        f"Today: {now.date().isoformat()}\n\n"
        f"Historical data:\n{chr(10).join(lines)}\n\n"
        "Predict demand for the next 30 days. Flag categories with < 2 active providers "
        "as shortage."
    )

    try:
        reply, _ = _call_openai(
            system_prompt,
            [{"role": "user", "content": user_message}],
            temperature=0.4,
            max_tokens=600,
        )
        parsed = json.loads(reply)
        raw_predictions = parsed.get("predictions")
        if not isinstance(raw_predictions, list) or not raw_predictions:
            raise ValueError("Missing predictions")

        predictions: list[DemandPrediction] = []
        for item in raw_predictions[:4]:
            if not isinstance(item, dict):
                continue

            category = str(item.get("category") or "other").strip().lower()
            try:
                predicted_requests = int(item.get("predicted_requests", 1))
            except (TypeError, ValueError):
                predicted_requests = 1
            predicted_requests = max(1, min(20, predicted_requests))

            confidence = str(item.get("confidence") or "low").strip().lower()
            if confidence not in {"high", "medium", "low"}:
                confidence = "low"

            provider_shortage = bool(item.get("provider_shortage"))
            shortage_note = str(item.get("shortage_note") or "").strip()
            reasoning = str(
                item.get("reasoning") or "Demand estimate based on recent activity."
            ).strip()

            if provider_counts.get(category, 0) < 2:
                provider_shortage = True
                if not shortage_note:
                    shortage_note = (
                        "Fewer than 2 active providers currently serve this neighborhood."
                    )

            predictions.append(
                DemandPrediction(
                    category=category,
                    predicted_requests=predicted_requests,
                    confidence=confidence,
                    reasoning=reasoning,
                    provider_shortage=provider_shortage,
                    shortage_note=shortage_note,
                )
            )

        if not predictions:
            raise ValueError("No valid predictions")

        return DemandForecastResponse(
            neighborhood=neighborhood,
            forecast_period="next 30 days",
            predictions=predictions,
            top_opportunity=str(
                parsed.get("top_opportunity")
                or "Monitor the highest-demand category for new jobs."
            ),
            stub=False,
        )
    except Exception:
        return _demand_forecast_stub(neighborhood)
