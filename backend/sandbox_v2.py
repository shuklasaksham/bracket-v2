"""Sandbox — try Bracket without signing up, connecting tools or paying.
Figma › 12 Sandbox. Contract: docs/API_V2.md § Sandbox (mock: mock/sandbox.js).

`POST /api/v2/sandbox/start` creates an anonymous guest (users.is_sandbox) with
a 2-hour session and seeds the demo project (demo.py), so every workspace
screen works unchanged. Requests that would touch a real account — connecting
tools, uploading, inviting, sending, paying, account changes — answer
403 { code: "sandbox_locked", action } from `SandboxLockMiddleware`; the app
turns that into the "start a free trial" prompt. Guests and their data are
purged when they leave or when the session expires.

Every start / tour step / locked tap / action is stored in `sandbox_events`
for Admin › Sandbox. Events carry no personal data.
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

import demo as _demo
from auth import SESSION_COOKIE, current_user, current_user_optional, delete_session
from connectors import db

logger = logging.getLogger("bracket.sandbox")
router = APIRouter(prefix="/api/v2/sandbox")
TTL = timedelta(hours=2)

LOCKED = [
    ("POST", r"^/api/v2/w/[^/]+/sources/(connect|add)$", "connect"),
    ("POST", r"^/api/v2/w/[^/]+/sources/[^/]+/(threads|reconnect|disconnect)$", "connect"),
    ("POST", r"^/api/v2/w/[^/]+/onboarding/", "connect"),
    ("POST", r"^/api/(connect|connectors|integrations|oauth)/", "connect"),
    ("POST", r"^/api/v2/w/[^/]+/notes$", "note"),
    ("POST", r"^/api/v2/w/[^/]+/files(/[^/]+/replace)?$", "upload"),
    ("DELETE", r"^/api/v2/w/[^/]+/files/", "upload"),
    ("POST", r"^/api/v2/w/[^/]+/members/invite$", "invite"),
    ("POST", r"^/api/v2/w/[^/]+/threads/[^/]+/send$", "send"),
    ("POST", r"^/api/v2/w/[^/]+/messages$", "send"),
    ("POST", r"^/api/demo/(send-email|client-reply)$", "send"),
    ("POST", r"^/api/v2/workspaces$", "workspace"),
    ("POST", r"^/api/projects$", "workspace"),
    ("POST", r"^/api/v2/w/[^/]+/(delete|archive|leave|export)$", "workspace"),
    ("POST", r"^/api/(v2/billing|payments)/", "billing"),
    ("PATCH", r"^/api/v2/billing$", "billing"),
    ("DELETE", r"^/api/(v2/me|auth/me)$", "account"),
    ("POST", r"^/api/v2/me/", "account"),
    ("PATCH", r"^/api/auth/me$", "account"),
    ("POST", r"^/api/auth/password/", "account"),
]
_LOCKED = [(m, re.compile(rx), a) for m, rx, a in LOCKED]
COPY = {
    "connect": "Connecting your own tools starts a free trial.",
    "note": "Adding your own notes starts a free trial.",
    "upload": "Adding your own files starts a free trial.",
    "invite": "Inviting your team starts a free trial.",
    "send": "Sending replies from your inbox starts a free trial.",
    "workspace": "Creating your own workspaces starts a free trial.",
    "billing": "Plans and billing start after the sandbox.",
    "account": "The sandbox has no account to change.",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def lock_for(method: str, path: str) -> Optional[str]:
    return next((a for m, rx, a in _LOCKED if m == method and rx.match(path)), None)


async def _event(sandbox_id: str, body: dict) -> None:
    try:
        await db.sandbox_events.insert_one({**body, "sandbox_id": sandbox_id, "at": _iso(_now())})
    except Exception:
        logger.exception("sandbox event write failed")


class SandboxLockMiddleware(BaseHTTPMiddleware):
    """403s account-touching requests from sandbox guests before any handler runs."""

    async def dispatch(self, request: Request, call_next):
        action = lock_for(request.method, request.url.path) if request.cookies.get(SESSION_COOKIE) else None
        if action:
            user = await current_user_optional(request, db)
            if user and user.get("is_sandbox"):
                await _event(user.get("sandbox_id", ""), {"type": "locked", "action": action})
                return JSONResponse(status_code=403, content={"detail": COPY[action], "code": "sandbox_locked", "action": action})
        return await call_next(request)


async def _guest(request: Request) -> dict:
    user = await current_user(request, db)
    if not user.get("is_sandbox"):
        raise HTTPException(404, "The sandbox isn’t open.")
    return user


async def _purge_guest(uid: str) -> None:
    proj = await _demo._get_demo_project(uid)
    if proj:
        await _demo._purge(uid, proj["id"])
    await db.user_sessions.delete_many({"user_id": uid})
    await db.users.delete_one({"user_id": uid, "is_sandbox": True})


def _state(proj: Optional[dict], user: dict) -> dict:
    st = (proj or {}).get("demo_state") or {}
    total = int(st.get("sim_total") or len(_demo.BEATS))
    beat = int(st.get("sim_step") or 0)
    return {"id": user.get("sandbox_id"), "beat": beat, "total": total, "done": beat >= total,
            "tour_step": int(user.get("sandbox_tour_step") or 1), "started_at": user.get("created_at")}


@router.post("/start")
async def start(request: Request):
    # A previous guest in this browser is replaced rather than reused.
    old = await current_user_optional(request, db)
    if old and old.get("is_sandbox"):
        await _purge_guest(old["user_id"])
    sid = "sbx_" + secrets.token_hex(6)
    uid = "guest_" + secrets.token_hex(8)
    now = _now()
    user = {"user_id": uid, "email": f"{sid}@sandbox.invalid", "name": "Maya Rao", "designation": "Design lead",
            "is_sandbox": True, "sandbox_id": sid, "sandbox_tour_step": 1, "sandbox_expires_at": _iso(now + TTL),
            "password_hash": "", "created_at": _iso(now), "updated_at": _iso(now)}
    await db.users.insert_one(dict(user))
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({"user_id": uid, "session_token": token, "expires_at": _iso(now + TTL), "created_at": _iso(now), "is_sandbox": True})
    proj = await _demo._seed(uid, user)
    await _event(sid, {"type": "start"})
    resp = JSONResponse({"ok": True, "workspace_id": proj["id"], "sandbox": _state(proj, user)})
    resp.set_cookie(SESSION_COOKIE, token, max_age=int(TTL.total_seconds()), httponly=True, secure=True, samesite="none", path="/")
    return resp


@router.get("")
async def get_state(request: Request):
    user = await current_user_optional(request, db)
    if not user or not user.get("is_sandbox"):
        return {"active": False, "sandbox": None}
    return {"active": True, "sandbox": _state(await _demo._get_demo_project(user["user_id"]), user)}


@router.post("/next")
async def play_next(request: Request):
    user = await _guest(request)
    out = await _demo.demo_simulate_next(request)
    await _event(user["sandbox_id"], {"type": "action", "action": "play"})
    return out


@router.post("/reset")
async def reset(request: Request):
    user = await _guest(request)
    out = await _demo.demo_reset(request)
    await _event(user["sandbox_id"], {"type": "action", "action": "reset"})
    proj = await _demo._get_demo_project(user["user_id"])
    return {"ok": True, "workspace_id": out["project_id"], "sandbox": _state(proj, user)}


@router.post("/leave")
async def leave(request: Request):
    user = await current_user_optional(request, db)
    if user and user.get("is_sandbox"):
        started = datetime.fromisoformat(user["created_at"].replace("Z", "+00:00"))
        await _event(user["sandbox_id"], {"type": "leave", "seconds": int((_now() - started).total_seconds()), "tour_step": user.get("sandbox_tour_step")})
        await _purge_guest(user["user_id"])
    await delete_session(db, request.cookies.get(SESSION_COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/", samesite="none", secure=True)
    return resp


class EventIn(BaseModel):
    type: str = Field(..., pattern=r"^(tour_step|tour_skip|action)$")
    step: Optional[int] = Field(None, ge=1, le=5)
    action: Optional[str] = Field(None, max_length=40)


@router.post("/events")
async def events(body: EventIn, request: Request):
    user = await current_user_optional(request, db)
    if not user or not user.get("is_sandbox"):
        return {"ok": True}
    if body.type == "tour_step" and body.step and body.step > int(user.get("sandbox_tour_step") or 0):
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"sandbox_tour_step": body.step}})
    await _event(user["sandbox_id"], body.model_dump(exclude_none=True) if hasattr(body, "model_dump") else body.dict(exclude_none=True))
    return {"ok": True}


async def cleanup_loop() -> None:
    """Every 15 minutes, purge guests whose 2-hour session has run out."""
    while True:
        try:
            async for u in db.users.find({"is_sandbox": True, "sandbox_expires_at": {"$lt": _iso(_now())}}, {"_id": 0, "user_id": 1}):
                await _purge_guest(u["user_id"])
        except Exception:
            logger.exception("sandbox cleanup failed")
        await asyncio.sleep(900)


def install(app) -> None:
    app.add_middleware(SandboxLockMiddleware)
    app.include_router(router)
    app.add_event_handler("startup", lambda: asyncio.get_event_loop().create_task(cleanup_loop()))
