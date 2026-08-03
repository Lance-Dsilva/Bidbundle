"""
Neighbourhood system: auto-assign users to location clusters (4-mile radius)
and auto-join them to their neighbourhood's general channel.
"""
from __future__ import annotations

import math

import httpx
from sqlalchemy.orm import Session

from models.neighbourhood import Neighbourhood, NeighbourhoodChannel, NeighbourhoodChannelMember
from models.user import User

RADIUS_MILES = 4.0


def _geocode_name(lat: float, lng: float) -> str | None:
    """Reverse-geocode lat/lng to a neighbourhood name via Nominatim."""
    try:
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {"lat": lat, "lon": lng, "format": "json"}
        headers = {"User-Agent": "NeighBid/1.0 (neighbid-app)"}
        resp = httpx.get(url, params=params, headers=headers, timeout=5.0)
        if resp.status_code == 200:
            addr = resp.json().get("address", {})
            return (
                addr.get("neighbourhood")
                or addr.get("suburb")
                or addr.get("city_district")
                or addr.get("quarter")
                or addr.get("village")
                or addr.get("town")
            )
    except Exception:
        pass
    return None


def _haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in miles between two lat/lng points."""
    R = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_or_create_neighbourhood(lat: float, lng: float, db: Session) -> Neighbourhood:
    """
    Return the existing neighbourhood whose centroid is within RADIUS_MILES of (lat, lng).
    If none exists, create a new one with (lat, lng) as the centroid.
    """
    neighbourhoods = db.query(Neighbourhood).all()
    for n in neighbourhoods:
        if _haversine_miles(lat, lng, n.centroid_lat, n.centroid_lng) <= RADIUS_MILES:
            return n

    count = db.query(Neighbourhood).count()
    geo_name = _geocode_name(lat, lng)
    name = geo_name or f"Neighbourhood #{count + 1}"
    new_neighbourhood = Neighbourhood(
        name=name,
        centroid_lat=lat,
        centroid_lng=lng,
    )
    db.add(new_neighbourhood)
    db.commit()
    db.refresh(new_neighbourhood)
    return new_neighbourhood


def auto_join_neighbourhood_channel(
    user: User, neighbourhood: Neighbourhood, db: Session
) -> NeighbourhoodChannel:
    """
    Get or create the general channel for this neighbourhood,
    then add the user as a member (idempotent).
    Returns the channel.
    """
    channel = db.query(NeighbourhoodChannel).filter(
        NeighbourhoodChannel.neighbourhood_id == neighbourhood.id
    ).first()

    if not channel:
        channel = NeighbourhoodChannel(neighbourhood_id=neighbourhood.id)
        db.add(channel)
        db.commit()
        db.refresh(channel)

    existing = db.query(NeighbourhoodChannelMember).filter(
        NeighbourhoodChannelMember.channel_id == channel.id,
        NeighbourhoodChannelMember.user_id == user.id,
    ).first()

    if not existing:
        member = NeighbourhoodChannelMember(channel_id=channel.id, user_id=user.id)
        db.add(member)
        db.commit()

    return channel
