"""
Group alert cron: find homeowners who could benefit from joining an existing group.
Call run_group_alerts(db) from the trigger endpoint or a real scheduler.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from models.notification import Notification
from models.request import ServiceRequest
from models.user import User


def run_group_alerts(db: Session) -> int:
    """
    For every homeowner with a request in status draft/live/grouping:
      - Find OTHER requests (not theirs) in same neighborhood + same category
        that are currently live or grouping.
      - If we haven't alerted this user about this other request in the last 7 days,
        create a Notification record.
    Returns the count of new notifications created.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    created_count = 0

    homeowner_requests = (
        db.query(ServiceRequest)
        .filter(ServiceRequest.status.in_(["draft", "live", "grouping"]))
        .all()
    )

    for my_req in homeowner_requests:
        user = db.query(User).filter(User.id == my_req.user_id).first()
        if not user or user.role != "homeowner":
            continue

        other_requests = (
            db.query(ServiceRequest)
            .filter(
                ServiceRequest.neighborhood == my_req.neighborhood,
                ServiceRequest.category == my_req.category,
                ServiceRequest.status.in_(["live", "grouping"]),
                ServiceRequest.user_id != my_req.user_id,
            )
            .all()
        )

        for other in other_requests:
            existing = (
                db.query(Notification)
                .filter(
                    Notification.user_id == my_req.user_id,
                    Notification.type == "group_alert",
                    Notification.action_url == f"/app/homeowner/bids?group={other.id}",
                    Notification.created_at >= cutoff,
                )
                .first()
            )
            if existing:
                continue

            bids_count = len(other.bids) if other.bids else 0
            title = f"Join a {other.category} group in {other.neighborhood}"
            body = (
                f"{bids_count} neighbor{'s' if bids_count != 1 else ''} already "
                f"requesting {other.category} this week — join their group and save."
            )

            notification = Notification(
                user_id=my_req.user_id,
                type="group_alert",
                title=title,
                body=body,
                action_url=f"/app/homeowner/bids?group={other.id}",
                read=False,
            )
            db.add(notification)
            created_count += 1

    db.commit()
    return created_count
