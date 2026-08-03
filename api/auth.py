import os

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, status

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# Local auth: /auth/login and /auth/register issue HS256 tokens signed with
# SECRET_KEY (iss=neighbid-local). Supabase ES256 tokens are still accepted
# when SUPABASE_URL is configured, for a later migration back.
SECRET_KEY = os.getenv("SECRET_KEY", "")
LOCAL_TOKEN_ISSUER = "neighbid-local"
_jwks_cache: dict = {}


def _get_jwks() -> dict:
    global _jwks_cache

    if not _jwks_cache:
        if not SUPABASE_URL:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            timeout=10,
        )
        response.raise_for_status()
        _jwks_cache = response.json()

    return _jwks_cache


def _get_supabase_signing_key(token: str):
    header = jwt.get_unverified_header(token)
    key_id = header.get("kid")
    for key in _get_jwks().get("keys", []):
        if key.get("kid") == key_id:
            return jwt.PyJWK.from_dict(key).key
    raise jwt.InvalidKeyError("No matching Supabase signing key")


def verify_supabase_token(token: str) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if SECRET_KEY:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            if isinstance(payload, dict) and payload.get("iss") == LOCAL_TOKEN_ISSUER:
                return payload
        except jwt.PyJWTError:
            pass  # not a local token — fall through to Supabase verification

    try:
        payload = jwt.decode(
            token,
            _get_supabase_signing_key(token),
            algorithms=["ES256"],
            audience="authenticated",
            options={"verify_aud": False},
        )
    except (jwt.PyJWTError, httpx.HTTPError, ValueError, TypeError) as exc:
        raise credentials_exception from exc

    if not isinstance(payload, dict):
        raise credentials_exception

    return payload
