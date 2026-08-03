from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine  # noqa: F401
from models.request_group import GroupMember, RequestGroup  # noqa: F401
from routers.admin import router as admin_router
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.bids import router as bids_router
from routers.community import router as community_router
from routers.homeowner import router as homeowner_router
from routers.hoa_ai import router as hoa_ai_router
from routers.hoa_community import router as hoa_community_router
from routers.neighbourhood import router as neighbourhood_router
from routers.notifications import router as notifications_router
from routers.provider import router as provider_router
from routers.recommendations import router as recommendations_router
from routers.requests import router as requests_router
from routers.users import router as users_router

load_dotenv()

app = FastAPI(title="BidBundle API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:19006"],
    # Allow phones/tablets on the local network hitting the dev server by LAN IP
    allow_origin_regex=r"http://(192\.168|10)\.\d+\.\d+(\.\d+)?:3000",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(ai_router)
app.include_router(requests_router)
app.include_router(bids_router)
app.include_router(users_router)
app.include_router(community_router)
app.include_router(admin_router)
app.include_router(provider_router)
app.include_router(homeowner_router)
app.include_router(recommendations_router)
app.include_router(notifications_router)
app.include_router(neighbourhood_router)
app.include_router(hoa_ai_router)
app.include_router(hoa_community_router)


@app.on_event("startup")
def startup():
    # Schema is managed by Supabase (supabase_schema.sql).
    # No DDL migrations needed at startup.
    pass


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
