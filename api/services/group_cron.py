"""
Group cron: flip expired grouping-phase groups to pending_approval.
Call run_group_cron(db) from the trigger endpoint or a real scheduler.
"""

from datetime import datetime

from sqlalchemy.orm import Session

from models.notification import Notification
from models.request_group import RequestGroup


def run_group_cron(db: Session) -> dict:
    """
    For every group whose grouping_closes_at has passed and status is still 'grouping':
    - If no active members remain -> cancel the group.
    - Otherwise -> flip to 'pending_approval' and notify all active members.
    Returns {"flipped": N, "cancelled": M}.
    """
    now = datetime.utcnow()
    expired = (
        db.query(RequestGroup)
        .filter(
            RequestGroup.status == "grouping",
            RequestGroup.grouping_closes_at <= now,
        )
        .all()
    )

    flipped = 0
    cancelled = 0

    for group in expired:
        active_members = [
            member for member in group.members if member.approval_status != "cancelled"
        ]
        if not active_members:
            group.status = "cancelled"
            cancelled += 1
            continue

        group.status = "pending_approval"
        flipped += 1
        for member in active_members:
            db.add(
                Notification(
                    user_id=member.user_id,
                    type="approval_needed",
                    title=f"Your {group.category} group needs your vote",
                    body=(
                        f"The 72-hour grouping window just closed with "
                        f"{len(active_members)} neighbour"
                        f"{'s' if len(active_members) != 1 else ''}. "
                        "Go to My Bids to approve or cancel - once everyone votes, "
                        "providers will see your group."
                    ),
                    action_url="/app/homeowner/bids",
                )
            )

    db.commit()
    return {"flipped": flipped, "cancelled": cancelled}
