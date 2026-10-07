"""Bracket backend — FastAPI entrypoint (anonymous, no-auth mode)."""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import httpx
import secrets as _secrets
from urllib.parse import urlencode as _urlencode
import io
import time
import asyncio
import logging
from typing import List, Literal, Dict, Any, Optional

from fastapi import FastAPI, APIRouter, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from fpdf import FPDF

from models import (
    ProjectStartIn,
    ProjectOut,
    SituationIn,
    ContextIn,
    DecisionIn,
    _uuid,
    _now_iso,
)
from ai_engine import (
    run_situation_framing,
    run_context_compression,
    run_decision_engine,
    run_artifacts,
    run_client_pushback_suggestions,
    run_field_suggestions,
    extract_text_from_image,
    auto_build_from_brief,
    generate_project_title,
    map_suggestion_to_step,
    draft_change_note,
    AIBackpressureError,
)
from push_notify import send_push_to_owner, send_push_to_user  # noqa: F401
from emailer import (
    send_thanks_email,
    send_review_outcome_email,
    send_client_receipt_email,
    send_owner_reply_email,
    send_document_updated_email,
    send_nps_survey_email,
    send_payment_receipt,
)
from auth import (
    SESSION_COOKIE,
    current_user,
    current_user_optional,
    create_session,
    delete_session,
    set_session_cookie,
    clear_session_cookie,
    exchange_emergent_session,
    get_or_create_user_by_email,
    gen_otp,
    store_otp,
    verify_otp as auth_verify_otp,
    send_otp_email,
    hash_password,
    verify_password,
    public_user,
    can_use_test_plan,
    TEST_PLAN_STATE,
    can_use_ph_launch,
    PH_LAUNCH_STATE,
    iso as auth_iso,
    now_utc as auth_now,
)
from pydantic import BaseModel as _BM, EmailStr as _Em, Field as _Fd


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("bracket")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Bracket API")
api = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# AI backpressure → HTTP 503 with Retry-After. When the AI concurrency
# semaphore is saturated (dozens of users pasting briefs at the same time),
# we return this instead of holding the request until Cloudflare's 100s
# origin timeout fires and shows the user a scary 524 page.
# ---------------------------------------------------------------------------
from fastapi.responses import JSONResponse as _JSONResponse


@app.exception_handler(AIBackpressureError)
async def _ai_backpressure_handler(request, exc):
    return _JSONResponse(
        status_code=503,
        headers={"Retry-After": "5"},
        content={
            "detail": (
                "Bracket is handling a surge of requests right now. "
                "Please retry in a few seconds."
            ),
            "code": "ai_backpressure",
        },
    )


# ---------------------------------------------------------------------------
# Catch-all safety net. Any unhandled exception here would otherwise bubble
# to Starlette's default handler which — under some circumstances (e.g. the
# exception fires while streaming the response, or the exception itself
# fails to serialise) — leaves Cloudflare seeing a truncated/invalid
# response and rendering the scary "520 · invalid or incomplete response"
# page. We always return a well-formed 500 JSON so Cloudflare has a clean
# origin response no matter what.
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def _catch_all_handler(request, exc):
    if isinstance(exc, (HTTPException, AIBackpressureError)):
        raise exc
    logger.exception("unhandled exception on %s %s", request.method, request.url.path)
    return _JSONResponse(
        status_code=500,
        content={
            "detail": "Something went wrong on our side. Please retry.",
            "code": "internal_error",
        },
    )


# --- health ---
@api.get("/")
async def root():
    return {"service": "bracket", "status": "ok"}


# ===========================================================================
# AUTH — Emergent Google + Email OTP + optional password
# ===========================================================================
class GoogleSessionIn(_BM):
    session_id: str = _Fd(min_length=8, max_length=400)


class OtpRequestIn(_BM):
    email: _Em
    name: str = _Fd(default="", max_length=120)


class OtpVerifyIn(_BM):
    email: _Em
    code: str = _Fd(min_length=4, max_length=8)
    # Optional onboarding fields when the user is brand new.
    name: str = _Fd(default="", max_length=120)
    designation: str = _Fd(default="", max_length=120)
    avatar: str = _Fd(default="mono-1", max_length=20)


class LoginIn(_BM):
    email: _Em
    password: str = _Fd(min_length=6, max_length=200)


class SetPasswordIn(_BM):
    password: str = _Fd(min_length=8, max_length=200)


class UpdateProfileIn(_BM):
    name: Optional[str] = _Fd(default=None, max_length=120)
    designation: Optional[str] = _Fd(default=None, max_length=120)
    avatar: Optional[str] = _Fd(default=None, max_length=20)


async def _heal_orphaned_identity(canonical_user_id: str, email: str) -> dict:
    """Self-healing identity merge. Past DB resets left `integration_accounts`
    and projects stranded under OLD user_ids (a new user_id is minted after a
    reset, but old connections/projects survive under the previous id). On each
    login we re-point that orphaned data onto the current canonical user_id,
    resolved via strong email signals (a gmail connection's label == the login
    email, or a project's creator_email). Idempotent and safe: only touches rows
    tied to THIS person's email."""
    email = (email or "").lower().strip()
    if not email or not canonical_user_id:
        return {"moved_accounts": 0, "moved_projects": 0}
    orphan_ids = set()
    async for a in db.integration_accounts.find({"provider": "gmail"}, {"_id": 0, "user_id": 1, "label": 1}):
        if (a.get("label") or "").lower().strip() == email and a.get("user_id"):
            orphan_ids.add(a["user_id"])
    async for p in db.projects.find({"creator_email": email}, {"_id": 0, "owner_user_id": 1}):
        if p.get("owner_user_id"):
            orphan_ids.add(p["owner_user_id"])
    orphan_ids.discard(canonical_user_id)
    if not orphan_ids:
        return {"moved_accounts": 0, "moved_projects": 0}
    orphan_list = list(orphan_ids)
    proj_res = await db.projects.update_many(
        {"owner_user_id": {"$in": orphan_list}},
        {"$set": {"owner_user_id": canonical_user_id}},
    )
    existing_providers = set()
    async for c in db.integration_accounts.find({"user_id": canonical_user_id}, {"_id": 0, "provider": 1}):
        existing_providers.add(c["provider"])
    moved = 0
    async for a in db.integration_accounts.find(
        {"user_id": {"$in": orphan_list}}, {"_id": 1, "provider": 1, "updated_at": 1}
    ).sort("updated_at", -1):
        prov = a["provider"]
        if prov in existing_providers:
            # Canonical already has this provider connected — drop the stale copy.
            await db.integration_accounts.delete_one({"_id": a["_id"]})
        else:
            await db.integration_accounts.update_one({"_id": a["_id"]}, {"$set": {"user_id": canonical_user_id}})
            existing_providers.add(prov)
            moved += 1
    if moved or proj_res.modified_count:
        logger.info(
            "[identity-heal] email=%s canonical=%s moved_accounts=%s moved_projects=%s orphans=%s",
            email, canonical_user_id, moved, proj_res.modified_count, orphan_list,
        )
    return {"moved_accounts": moved, "moved_projects": proj_res.modified_count, "orphans": orphan_list}



@api.post("/auth/google/exchange")
async def auth_google_exchange(body: GoogleSessionIn, request: Request, response: Response):
    """Exchange the Emergent session_id (from #session_id=... fragment) for an
    httpOnly cookie that the rest of the app uses."""
    data = await exchange_emergent_session(body.session_id)
    meta = _extract_client_meta(request)
    user = await get_or_create_user_by_email(
        db,
        data["email"],
        name=data.get("name") or "",
        picture=data.get("picture") or "",
        signup_ip=meta["signup_ip"],
        signup_user_agent=meta["signup_user_agent"],
    )
    await _heal_orphaned_identity(user["user_id"], user.get("email", ""))
    token = await create_session(db, user["user_id"])
    set_session_cookie(response, token)
    return {"user": public_user(user), "session_token": token, "is_new": not bool(user.get("name"))}


def _request_base_url(request: Request) -> str:
    """Prefer the requesting external host so OAuth login works on BOTH preview
    and production; fall back to PUBLIC_BASE_URL. (Both callback URLs must be
    registered in the Google OAuth client.)"""
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if host and "cluster" not in host and "localhost" not in host:
        proto = request.headers.get("x-forwarded-proto", "https")
        base = f"{proto}://{host}"
    return base


@api.get("/auth/google/native/start")
async def google_native_start(request: Request):
    """Native Google OAuth (our OWN Google Cloud credentials) — replaces the
    Emergent-managed consent screen so users see Google's standard screen on
    Bracket's own domain. Server-side authorization-code redirect flow.
    REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH"""
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=500, detail="Google login isn't configured.")
    redirect_uri = f"{_request_base_url(request)}/api/auth/google/native/callback"
    state = _secrets.token_urlsafe(24)
    await db.oauth_states.insert_one({"state": state, "provider": "login_google",
                                      "redirect_uri": redirect_uri, "created_at": auth_iso(auth_now())})
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
        "include_granted_scopes": "true",
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{_urlencode(params)}", status_code=302)


@api.get("/auth/google/native/callback")
async def google_native_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    base = _request_base_url(request)
    if error or not code or not state:
        return RedirectResponse(f"{base}/login?err=google", status_code=302)
    row = await db.oauth_states.find_one({"state": state, "provider": "login_google"})
    if row:
        await db.oauth_states.delete_one({"state": state})
    if not row:
        return RedirectResponse(f"{base}/login?err=google_state", status_code=302)
    redirect_uri = row.get("redirect_uri") or f"{base}/api/auth/google/native/callback"
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            tr = await c.post("https://oauth2.googleapis.com/token", data={
                "code": code, "client_id": client_id, "client_secret": client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
            if tr.status_code != 200:
                logger.warning("[auth] google native token exchange failed: %s %s", tr.status_code, tr.text[:300])
                return RedirectResponse(f"{base}/login?err=google_token", status_code=302)
            access_token = tr.json().get("access_token")
            ui = await c.get("https://openidconnect.googleapis.com/v1/userinfo",
                             headers={"Authorization": f"Bearer {access_token}"})
            if ui.status_code != 200:
                logger.warning("[auth] google native userinfo failed: %s %s", ui.status_code, ui.text[:300])
                return RedirectResponse(f"{base}/login?err=google_userinfo", status_code=302)
            info = ui.json()
    except Exception:
        logger.exception("[auth] google native callback crashed")
        return RedirectResponse(f"{base}/login?err=google", status_code=302)
    email = (info.get("email") or "").lower().strip()
    if not email:
        return RedirectResponse(f"{base}/login?err=google_email", status_code=302)
    meta = _extract_client_meta(request)
    user = await get_or_create_user_by_email(
        db, email, name=info.get("name") or "", picture=info.get("picture") or "",
        signup_ip=meta["signup_ip"], signup_user_agent=meta["signup_user_agent"],
    )
    await _heal_orphaned_identity(user["user_id"], email)
    token = await create_session(db, user["user_id"])
    dest = "/app" if user.get("plan") else "/plan"
    resp = RedirectResponse(f"{base}{dest}", status_code=302)
    set_session_cookie(resp, token)
    logger.info("[auth] google native login ok email=%s user_id=%s → %s", email, user["user_id"], dest)
    return resp


@api.post("/auth/otp/request")
async def auth_otp_request(body: OtpRequestIn):
    from datetime import datetime as _dt, timezone as _tz
    email_norm = body.email.lower().strip()
    bracket_env = (os.environ.get("BRACKET_ENV") or "").strip().lower()
    otp_flag = os.environ.get("OTP_TEST_MODE") == "1"
    test_mode = bracket_env != "production" and otp_flag
    # Throttle: never send more than one passcode email per ~45s for the same
    # address. Stops passcode-spam from double submits, client retries, browser
    # prefetch, or an unexpected caller. Skipped in test mode so headless tests
    # always receive a fresh dev_code.
    if not test_mode:
        recent = await db.email_otps.find_one({"email": email_norm}, {"_id": 0, "issued_at": 1})
        if recent and recent.get("issued_at"):
            try:
                issued = _dt.fromisoformat(str(recent["issued_at"]).replace("Z", "+00:00"))
                if (_dt.now(_tz.utc) - issued).total_seconds() < 45:
                    return {"ok": True, "ttl_minutes": 10, "throttled": True}
            except Exception:
                pass
    code = gen_otp()
    await store_otp(db, email_norm, code)
    name = (body.name or "").strip()
    if not name:
        u = await db.users.find_one({"email": email_norm}, {"_id": 0, "name": 1})
        name = (u or {}).get("name", "")
    await send_otp_email(email_norm, name, code)
    resp: Dict[str, Any] = {"ok": True, "ttl_minutes": 10}
    # Test-only convenience: return the OTP in the response so the testing
    # agent can log in headlessly (guarded by BRACKET_ENV + OTP_TEST_MODE).
    if test_mode:
        resp["dev_code"] = code
    return resp


@api.post("/auth/otp/verify")
async def auth_otp_verify(body: OtpVerifyIn, request: Request, response: Response):
    await auth_verify_otp(db, body.email, body.code)
    meta = _extract_client_meta(request)
    existing = await db.users.find_one({"email": body.email.lower().strip()}, {"_id": 0})
    if existing:
        # Update any fields the user passed (onboarding for fresh accounts).
        updates: Dict[str, Any] = {}
        if body.name and not existing.get("name"):
            updates["name"] = body.name.strip()
        if body.designation and not existing.get("designation"):
            updates["designation"] = body.designation.strip()
        if body.avatar:
            updates["avatar"] = body.avatar
        # Backfill signup meta once if this is the first observed IP/UA.
        if not existing.get("signup_ip") and meta["signup_ip"]:
            updates["signup_ip"] = meta["signup_ip"]
        if not existing.get("signup_user_agent") and meta["signup_user_agent"]:
            updates["signup_user_agent"] = meta["signup_user_agent"]
        if updates:
            updates["updated_at"] = auth_iso(auth_now())
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": updates})
            existing.update(updates)
        user = existing
        is_new = False
    else:
        user = await get_or_create_user_by_email(
            db,
            body.email,
            name=body.name,
            designation=body.designation,
            avatar=body.avatar or "mono-1",
            signup_ip=meta["signup_ip"],
            signup_user_agent=meta["signup_user_agent"],
        )
        is_new = True
    await _heal_orphaned_identity(user["user_id"], user.get("email", ""))
    token = await create_session(db, user["user_id"])
    set_session_cookie(response, token)
    return {"user": public_user(user), "session_token": token, "is_new": is_new}


@api.post("/auth/login")
async def auth_password_login(body: LoginIn, response: Response):
    user = await db.users.find_one({"email": body.email.lower().strip()}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="No password set for this email. Sign in with OTP first.")
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    token = await create_session(db, user["user_id"])
    set_session_cookie(response, token)
    return {"user": public_user(user), "session_token": token, "is_new": False}


@api.post("/auth/password/set")
async def auth_set_password(body: SetPasswordIn, request: Request):
    user = await current_user(request, db)
    h = hash_password(body.password)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": h, "updated_at": auth_iso(auth_now())}},
    )
    return {"ok": True}


@api.get("/auth/me")
async def auth_me(request: Request):
    # Anonymous visitors get 200 + null instead of a noisy 401 — public pages
    # (landing, /r/{token}) probe this on every load.
    try:
        user = await current_user(request, db)
    except HTTPException:
        return None
    return public_user(user)


@api.patch("/auth/me")
async def auth_update_me(body: UpdateProfileIn, request: Request):
    user = await current_user(request, db)
    updates = {k: (v or "").strip() if isinstance(v, str) else v
               for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return public_user(user)
    updates["updated_at"] = auth_iso(auth_now())
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(fresh)


@api.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE) or ""
    if not token:
        ah = request.headers.get("authorization", "")
        if ah.lower().startswith("bearer "):
            token = ah.split(" ", 1)[1]
    if token:
        await delete_session(db, token)
    clear_session_cookie(response)
    return {"ok": True}


def _extract_client_meta(request: Optional[Request]) -> Dict[str, str]:
    """Best-effort capture of the caller's IP + user-agent for user creation.
    Prefers Cloudflare's `CF-Connecting-IP`, then the first `X-Forwarded-For`
    entry (we're behind CF/nginx in production), then the direct socket peer.
    Both fields are truncated to keep the users doc small."""
    if request is None:
        return {"signup_ip": "", "signup_user_agent": ""}
    headers = request.headers
    ip = (
        headers.get("cf-connecting-ip")
        or (headers.get("x-forwarded-for", "").split(",")[0].strip() if headers.get("x-forwarded-for") else "")
        or headers.get("x-real-ip")
        or (request.client.host if request.client else "")
        or ""
    )
    ua = headers.get("user-agent", "")
    return {
        "signup_ip": ip[:64],
        "signup_user_agent": ua[:400],
    }


# ---- GUEST SIGN-IN (no email, no password) ---------------------------------
# Used by the "Try it without an account" button. Creates an `is_guest: true`
# user with a synthetic email so the rest of the app (which keys on user_id)
# keeps working without conditional code paths. The user can later upgrade
# via POST /auth/me/email to convert the guest into a real account.
@api.post("/auth/guest")
async def auth_guest(request: Request, response: Response):
    from auth import gen_user_id as _gen_uid
    user_id = _gen_uid()
    # Sequential guest numbering: atomic counter in `counters.guest_seq` so
    # every guest gets a stable, human-readable email like
    # guest-01@use-bracket.com, guest-02@use-bracket.com, ...
    counter = await db.counters.find_one_and_update(
        {"_id": "guest_seq"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq_num = int(counter.get("seq", 1)) if counter else 1
    synthetic_email = f"guest-{seq_num:02d}@use-bracket.com"
    meta = _extract_client_meta(request)
    doc = {
        "user_id": user_id,
        "email": synthetic_email,
        "name": "Guest",
        "designation": "",
        "avatar": "mono-1",
        "picture": "",
        "password_hash": "",
        "is_guest": True,
        "signup_ip": meta["signup_ip"],
        "signup_user_agent": meta["signup_user_agent"],
        "created_at": auth_iso(auth_now()),
        "updated_at": auth_iso(auth_now()),
    }
    await db.users.insert_one(doc)
    token = await create_session(db, user_id)
    set_session_cookie(response, token)
    return {"user": public_user(doc), "session_token": token, "is_new": True}


# ---- GUEST UPGRADE (set email + name, lift the is_guest flag) --------------
class GuestUpgradeIn(_BM):
    email: _Em
    name: str = _Fd(default="", max_length=120)


import re as _re
# Matches both legacy `guest+<id>@bracket.guest` and current
# `guest-NN@use-bracket.com` synthetic guest emails.
_GUEST_EMAIL_RE = _re.compile(
    r"^(guest\+[a-zA-Z0-9_-]+@bracket\.guest|guest-\d+@use-bracket\.com)$",
    _re.IGNORECASE,
)


def _is_guest_email(email: Optional[str]) -> bool:
    if not email:
        return False
    return bool(_GUEST_EMAIL_RE.match(email.strip().lower()))


@api.post("/auth/me/email")
async def auth_guest_upgrade(body: GuestUpgradeIn, request: Request):
    """A signed-in guest gives us their email + name on their way out.
    Refuses if the email is already taken by a real account."""
    user = await current_user(request, db)
    new_email = body.email.lower().strip()
    if _is_guest_email(new_email):
        raise HTTPException(status_code=400, detail="That's not a real email.")
    # Block if a real account already exists.
    clash = await db.users.find_one(
        {"email": new_email, "user_id": {"$ne": user["user_id"]}},
        {"_id": 0, "user_id": 1},
    )
    if clash:
        raise HTTPException(
            status_code=409,
            detail="That email is already in use — sign in instead.",
        )
    updates: Dict[str, Any] = {
        "email": new_email,
        "is_guest": False,
        "updated_at": auth_iso(auth_now()),
    }
    if body.name.strip():
        updates["name"] = body.name.strip()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(fresh)


# ---- AI AUTOFILL SUGGESTIONS (debounced from the form fields) --------------
class SuggestIn(_BM):
    step: int = _Fd(ge=1, le=5)
    field: str = _Fd(min_length=1, max_length=40)
    partial: str = _Fd(default="", max_length=500)
    context: Dict[str, Any] = _Fd(default_factory=dict)


@api.post("/suggest")
async def ai_suggest(body: SuggestIn, request: Request):
    """Returns 0-4 short autofill suggestions for a form field. Safe to call
    on every keystroke (frontend debounces 600ms); errors return empty list,
    not 500, so a hiccup never blocks the user's typing. Requires a logged-in
    user so anonymous callers can't burn LLM budget."""
    await current_user(request, db)
    suggestions = await run_field_suggestions(
        body.step, body.field, body.partial, body.context
    )
    return {"suggestions": suggestions}


import re as _re


def _email_match(email: str):
    """Case-insensitive exact email match (anonymous-mode projects may have
    stored creator_email with mixed casing)."""
    return {"$regex": f"^{_re.escape((email or '').strip())}$", "$options": "i"}


# ---- CLAIM ANONYMOUS PROJECTS -----------------------------------------------
@api.get("/auth/claimable")
async def auth_claimable(request: Request):
    """Projects in the DB that match this user's email but have no owner yet."""
    user = await current_user(request, db)
    cur = (
        db.projects.find(
            {
                "creator_email": _email_match(user["email"]),
                "$or": [
                    {"owner_user_id": {"$exists": False}},
                    {"owner_user_id": ""},
                    {"owner_user_id": None},
                ],
            },
            {"_id": 0, "id": 1, "name": 1, "status": 1, "step": 1, "share_status": 1, "created_at": 1, "updated_at": 1},
        )
        .sort("updated_at", -1)
        .limit(100)
    )
    return [d async for d in cur]


class ClaimDecisionIn(_BM):
    keep_ids: list[str] = _Fd(default_factory=list)
    delete_ids: list[str] = _Fd(default_factory=list)


@api.post("/auth/claim")
async def auth_claim(body: ClaimDecisionIn, request: Request):
    user = await current_user(request, db)
    claimed = 0
    deleted = 0
    if body.keep_ids:
        res = await db.projects.update_many(
            {"id": {"$in": body.keep_ids}, "creator_email": _email_match(user["email"])},
            {"$set": {"owner_user_id": user["user_id"], "updated_at": auth_iso(auth_now())}},
        )
        claimed = res.modified_count
    if body.delete_ids:
        res = await db.projects.delete_many(
            {"id": {"$in": body.delete_ids}, "creator_email": _email_match(user["email"])},
        )
        deleted = res.deleted_count
    return {"claimed": claimed, "deleted": deleted}


# ===========================================================================
# PUBLIC METRICS — safe aggregate counters for the landing page.
# No authentication required. Only aggregated counts are returned; no
# individual project or user data leaks.
# ===========================================================================
# ─── Web Push subscriptions ─────────────────────────────────────────────
class PushSubscribeIn(BaseModel):
    subscription: Dict[str, Any]


@api.get("/push/vapid-public-key")
async def push_vapid_public_key():
    return {"public_key": os.environ.get("VAPID_PUBLIC_KEY", "")}


@api.post("/push/subscribe")
async def push_subscribe(body: PushSubscribeIn, request: Request):
    user = await current_user(request, db)
    endpoint = (body.subscription or {}).get("endpoint", "")
    if not endpoint:
        raise HTTPException(status_code=422, detail="Invalid subscription.")
    await db.push_subscriptions.update_one(
        {"user_id": user["user_id"], "subscription.endpoint": endpoint},
        {"$set": {
            "user_id": user["user_id"],
            "subscription": body.subscription,
            "user_agent": request.headers.get("user-agent", ""),
            "updated_at": _now_iso(),
        }, "$setOnInsert": {"created_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/push/unsubscribe")
async def push_unsubscribe(body: PushSubscribeIn, request: Request):
    user = await current_user(request, db)
    endpoint = (body.subscription or {}).get("endpoint", "")
    await db.push_subscriptions.delete_many(
        {"user_id": user["user_id"], "subscription.endpoint": endpoint}
    )
    return {"ok": True}


@api.get("/public/metrics")
async def public_metrics(response: Response):
    """Aggregate KPIs shown on the landing page's metrics strip. All counts
    are numeric only — no identifiers, no content."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    # 1. Freelancers & Teams — total signed-up users.
    total_users = await db.users.count_documents({})

    # 2. Projects Scoped — projects that reached the artifacts step
    # (i.e. a scope doc, client message, assumptions and risk flags were
    # generated). We accept either a locked project or one that has any
    # artifacts field populated.
    projects_scoped = await db.projects.count_documents({
        "$or": [
            {"status": "locked"},
            {"artifacts": {"$exists": True, "$nin": [None, {}]}},
        ],
    })

    # 3. Projects Started with AI — any project where the framing step has
    # produced output (i.e. the user actually used Bracket's brain).
    projects_started = await db.projects.count_documents({
        "framing": {"$exists": True, "$nin": [None, {}]},
    })

    # 4/5/6 — array-length sums via aggregation. We coerce missing/non-array
    # fields to empty arrays so $size never explodes.
    def _sum_size(field: str) -> list[dict]:
        return [
            {"$project": {"n": {"$size": {"$ifNull": [field, []]}}}},
            {"$group": {"_id": None, "total": {"$sum": "$n"}}},
        ]

    async def _agg_sum(pipeline: list[dict]) -> int:
        async for row in db.projects.aggregate(pipeline):
            return int(row.get("total") or 0)
        return 0

    # Requirements Extracted — AI-surfaced "key signals" that actually drive
    # the decision (context step output).
    requirements_extracted = await _agg_sum(_sum_size("$context.key_signals"))

    # Risks Identified — every risk called out across all decisions and
    # artifact risk-flag lists.
    risks_from_decision = await _agg_sum(_sum_size("$decision.risks"))
    risks_from_artifacts = await _agg_sum(_sum_size("$artifacts.risk_flags"))
    risks_identified = risks_from_decision + risks_from_artifacts

    # Client Questions Generated — assumptions surfaced during artifacts
    # (things the freelancer should verify with the client before shipping).
    client_questions = await _agg_sum(_sum_size("$artifacts.assumptions"))

    return {
        "freelancers_and_teams": total_users,
        "projects_scoped": projects_scoped,
        "requirements_extracted": requirements_extracted,
        "risks_identified": risks_identified,
        "client_questions_generated": client_questions,
        "projects_started_with_ai": projects_started,
    }


# ---- Session / acquisition tracking ----------------------------------------
# Public endpoint the landing page POSTs to on first paint. Captures
# referrer + UTM params so we can compute acquisition attribution in the
# admin dashboard. Never links to a specific user unless the visitor later
# signs in (then user_id is set on the row via a separate merge).
class SessionTrackIn(_BM):
    session_id: str = _Fd(min_length=8, max_length=64)
    path: str = _Fd(default="/", max_length=200)
    referrer: str = _Fd(default="", max_length=500)
    utm_source: str = _Fd(default="", max_length=120)
    utm_medium: str = _Fd(default="", max_length=120)
    utm_campaign: str = _Fd(default="", max_length=120)
    utm_term: str = _Fd(default="", max_length=120)
    utm_content: str = _Fd(default="", max_length=120)


def _referrer_bucket(ref: str, utm_source: str) -> str:
    """Cheap traffic-source bucket. Priority: utm_source > referrer host."""
    if utm_source:
        return utm_source.lower()
    if not ref:
        return "direct"
    try:
        from urllib.parse import urlparse
        host = (urlparse(ref).hostname or "").lower()
    except Exception:
        return "other"
    for pattern, bucket in [
        ("google.", "google"),
        ("bing.", "bing"),
        ("duckduckgo.", "duckduckgo"),
        ("twitter.", "twitter"), ("t.co", "twitter"), ("x.com", "twitter"),
        ("linkedin.", "linkedin"),
        ("facebook.", "facebook"), ("fb.", "facebook"),
        ("instagram.", "instagram"),
        ("youtube.", "youtube"),
        ("reddit.", "reddit"),
        ("producthunt.", "producthunt"),
        ("github.", "github"),
    ]:
        if pattern in host:
            return bucket
    return host or "other"


@api.post("/public/track/session")
async def track_session(body: SessionTrackIn, request: Request):
    """Upsert an acquisition-tracking row. Idempotent per session_id.
    Also increments `page_views` on every ping and captures the visitor's
    IP so we can resolve it to a country for the admin geo map.
    """
    now = auth_iso(auth_now())
    source = _referrer_bucket(body.referrer, body.utm_source)
    user_id = None
    try:
        u = await current_user(request, db)
        user_id = u.get("user_id")
    except Exception:
        user_id = None

    # Extract the first client IP from X-Forwarded-For / X-Real-IP if present
    # (we sit behind Cloudflare + K8s ingress, so `request.client.host` is
    # always the ingress pod IP).
    ip = ""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        ip = xff.split(",")[0].strip()
    if not ip:
        ip = (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip") or "").strip()
    if not ip:
        try:
            ip = (request.client.host if request.client else "") or ""
        except Exception:
            ip = ""

    doc = {
        "referrer": body.referrer,
        "utm_source": body.utm_source,
        "utm_medium": body.utm_medium,
        "utm_campaign": body.utm_campaign,
        "utm_term": body.utm_term,
        "utm_content": body.utm_content,
        "source_bucket": source,
        "last_path": body.path,
        "last_seen_at": now,
    }
    if ip:
        doc["ip"] = ip
    add_user = {"user_ids": user_id} if user_id else {"user_ids": "__anon__"}
    try:
        await db.sessions.update_one(
            {"session_id": body.session_id},
            {
                "$set": doc,
                "$setOnInsert": {"first_seen_at": now},
                "$addToSet": add_user,
                "$inc": {"page_views": 1},
            },
            upsert=True,
        )
    except Exception as e:
        logger.warning("track_session write failed (non-fatal): %s", e)

    # Kick off geo lookup in the background — never block the request.
    if ip and not _ip_is_private(ip):
        asyncio.create_task(_ensure_geo_for_ip(ip))
    return {"ok": True}


# ---- Click tracking (Bracket's own heat-map) --------------------------------
class ClickTrackIn(_BM):
    session_id: str = _Fd(min_length=8, max_length=64)
    path:       str = _Fd(default="/", max_length=200)
    # Normalized click position — x/y as a fraction of viewport [0.0, 1.0].
    # Backend stores the fraction (device-independent) and the viewport
    # width so the admin heat-map can rebuild a faithful scatter later.
    x_frac:     float = _Fd(ge=0.0, le=1.0)
    y_frac:     float = _Fd(ge=0.0, le=1.0)
    vp_w:       int = _Fd(ge=100, le=8000)
    vp_h:       int = _Fd(ge=100, le=8000)
    tag:        str = _Fd(default="", max_length=40)


@api.post("/public/track/click")
async def track_click(body: ClickTrackIn, request: Request):
    """Store a single click event for the admin click-density heat-map.
    Fire-and-forget: any DB failure is swallowed."""
    try:
        await db.click_events.insert_one({
            "id":          _uuid(),
            "session_id":  body.session_id,
            "path":        body.path,
            "x_frac":      round(body.x_frac, 4),
            "y_frac":      round(body.y_frac, 4),
            "vp_w":        body.vp_w,
            "vp_h":        body.vp_h,
            "tag":         body.tag[:40],
            "created_at":  auth_iso(auth_now()),
        })
    except Exception as e:
        logger.warning("track_click write failed (non-fatal): %s", e)
    return {"ok": True}


# ---- Geo lookup helpers -----------------------------------------------------
def _ip_is_private(ip: str) -> bool:
    """Skip lookups for private / loopback / IPv6 link-local ranges."""
    if not ip or ip.startswith(("127.", "10.", "0.", "192.168.", "169.254.")):
        return True
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (IndexError, ValueError):
            pass
    if ip in {"::1", "localhost"}:
        return True
    if ":" in ip and ip.startswith(("fe80", "fc", "fd", "::")):
        return True
    return False


async def _ensure_geo_for_ip(ip: str) -> None:
    """Cache-first: skip if we've already resolved this IP. Otherwise hit
    the free ip-api.com endpoint (45 req/min) and store the result."""
    if not ip or _ip_is_private(ip):
        return
    try:
        cached = await db.geoip_cache.find_one({"_id": ip}, {"_id": 1})
        if cached:
            return
    except Exception:
        return
    try:
        import urllib.request as _u
        import json as _json
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,region,city,lat,lon,query"
        # Small timeout so a slow ip-api never wedges the background task pool.
        req = _u.Request(url, headers={"User-Agent": "bracket-analytics/1.0"})
        with _u.urlopen(req, timeout=4) as resp:  # noqa: S310 -- http OK, free tier
            payload = _json.loads(resp.read().decode("utf-8") or "{}")
    except Exception as e:
        logger.info("geoip lookup failed for %s: %s", ip, e)
        payload = {}
    if payload.get("status") != "success":
        payload = {"status": "fail"}
    try:
        await db.geoip_cache.update_one(
            {"_id": ip},
            {"$set": {
                "country":     payload.get("country", ""),
                "countryCode": payload.get("countryCode", ""),
                "region":      payload.get("region", ""),
                "city":        payload.get("city", ""),
                "lat":         payload.get("lat"),
                "lon":         payload.get("lon"),
                "status":      payload.get("status", "fail"),
                "updated_at":  auth_iso(auth_now()),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.info("geoip cache write failed for %s: %s", ip, e)


# ===========================================================================
# ADMIN — hidden, gated by ADMIN_EMAILS env var. Not linked from anywhere
# public. Non-admin sessions get 404 (deliberately misleading) so the
# existence of /api/admin is never revealed to end users.
# ===========================================================================
from auth import current_admin as auth_current_admin  # local import to keep group


class AdminResetPasswordIn(_BM):
    new_password: str = _Fd(min_length=8, max_length=128)


@api.get("/admin/users")
async def admin_list_users(
    request: Request,
    kind: str = "all",           # all | guest | registered
    min_projects: int = 0,
    max_projects: Optional[int] = None,
):
    admin = await auth_current_admin(request, db)
    # Project counts per user_id, in one aggregation pass.
    counts: Dict[str, int] = {}
    async for row in db.projects.aggregate([
        {"$match": {"owner_user_id": {"$type": "string"}}},
        {"$group": {"_id": "$owner_user_id", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]

    users_out = []
    cur = db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).limit(2000)
    async for u in cur:
        uid = u.get("user_id", "")
        email = u.get("email") or ""
        is_guest = bool(u.get("is_guest")) or _is_guest_email(email)
        pc = counts.get(uid, 0)

        # Server-side filters (cheap in a single pass on ≤2000 rows)
        if kind == "guest" and not is_guest:
            continue
        if kind == "registered" and is_guest:
            continue
        if pc < min_projects:
            continue
        if max_projects is not None and pc > max_projects:
            continue

        users_out.append({
            "user_id": uid,
            "email": email,
            "name": u.get("name", ""),
            "designation": u.get("designation", ""),
            "avatar": u.get("avatar", ""),
            "picture": u.get("picture", ""),
            "created_at": u.get("created_at"),
            "updated_at": u.get("updated_at"),
            "last_seen_at": u.get("last_seen_at"),
            "signup_ip": u.get("signup_ip", ""),
            "signup_user_agent": u.get("signup_user_agent", ""),
            "is_admin": email.lower() in {admin["email"].lower(), *_admin_emails_set()},
            "is_guest": is_guest,
            "project_count": pc,
        })
    return {"users": users_out, "admin_email": admin["email"], "filter": {"kind": kind, "min_projects": min_projects, "max_projects": max_projects}}


def _admin_emails_set() -> set:
    """Helper that resolves the env at call time (cannot import circularly)."""
    from auth import admin_emails as _ae
    return _ae()


@api.get("/admin/users/{user_id}/projects")
async def admin_user_projects(user_id: str, request: Request):
    await auth_current_admin(request, db)
    cur = (
        db.projects.find(
            {"owner_user_id": user_id},
            {"_id": 0, "id": 1, "name": 1, "status": 1, "step": 1, "share_status": 1, "created_at": 1, "updated_at": 1, "locked_at": 1},
        )
        .sort("updated_at", -1)
        .limit(500)
    )
    return {"projects": [d async for d in cur]}


# --- ONE-OFF ADMIN CLEANUP -------------------------------------------------
# Purges users matching one or more email regex patterns + cascades their
# projects, user_sessions, email_otps, and session_id refs. Dry-run by default.
# Used to nuke automation-test accounts (e2e-*, hp-test-*, overview-*, etc.)
# from any environment — call once, gate behind explicit confirm=true.

# Baked-in safelist of automation patterns. Callers can override via `patterns`.
_DEFAULT_AUTOMATION_PATTERNS = [
    r"^e2e-",
    r"^e2e\+",
    r"^hp-test-",
    r"^overview-",
    r"^nonadmin-",
    r"^reset-target-",
    r"^flow-fixes-",
    r"^s4-auto-",
    r"^output-unify-",
    r"^upgraded-",
    r"^bracket-test-",
]


class PurgeUsersIn(_BM):
    # Comma-separated regexes. If empty/omitted, uses the default automation set.
    patterns: str = _Fd(default="", max_length=2000)
    # Safety: must be True for anything to actually get deleted.
    confirm: bool = _Fd(default=False)


@api.post("/admin/purge-users")
async def admin_purge_users(body: PurgeUsersIn, request: Request):
    """One-off cleanup — deletes users whose email matches any of the given
    regex patterns, plus cascades their projects / user_sessions / OTP codes /
    session_id refs. Never touches admins. Returns counts (never raises unless
    the caller isn't an admin). Dry-run by default; set `confirm=true` to
    actually delete."""
    admin = await auth_current_admin(request, db)
    patterns = [p.strip() for p in body.patterns.split(",") if p.strip()] or list(_DEFAULT_AUTOMATION_PATTERNS)
    admin_emails = {admin["email"].lower(), *_admin_emails_set()}

    regex_filter = {"$or": [{"email": {"$regex": p}} for p in patterns]}
    # Never delete admins even if the pattern would match.
    if admin_emails:
        regex_filter = {"$and": [regex_filter, {"email": {"$nin": list(admin_emails)}}]}

    victims = await db.users.find(regex_filter, {"user_id": 1, "email": 1, "_id": 0}).to_list(length=10000)
    victim_ids = [v["user_id"] for v in victims]
    victim_emails = [v["email"] for v in victims]

    proj_count = await db.projects.count_documents({
        "$or": [
            {"owner_user_id": {"$in": victim_ids}},
            {"creator_email": {"$in": victim_emails}},
        ]
    })
    session_count = await db.user_sessions.count_documents({"user_id": {"$in": victim_ids}})
    otp_count = await db.email_otps.count_documents({"email": {"$in": victim_emails}})

    result = {
        "dry_run": not body.confirm,
        "patterns": patterns,
        "matched_users": len(victims),
        "cascade": {
            "projects": proj_count,
            "user_sessions": session_count,
            "email_otps": otp_count,
        },
        "sample_emails": victim_emails[:10],
    }

    if not body.confirm:
        return result

    # Actually delete — cascade order matters (children before parents).
    proj_del = await db.projects.delete_many({
        "$or": [
            {"owner_user_id": {"$in": victim_ids}},
            {"creator_email": {"$in": victim_emails}},
        ]
    })
    sess_del = await db.user_sessions.delete_many({"user_id": {"$in": victim_ids}})
    otp_del = await db.email_otps.delete_many({"email": {"$in": victim_emails}})
    # Remove victim user_ids from any session-tracking documents.
    await db.sessions.update_many(
        {"user_ids": {"$in": victim_ids}},
        {"$pull": {"user_ids": {"$in": victim_ids}}},
    )
    users_del = await db.users.delete_many(regex_filter)

    logger.info(
        "[admin/purge-users] admin=%s deleted users=%s projects=%s sessions=%s otps=%s",
        admin["email"], users_del.deleted_count, proj_del.deleted_count,
        sess_del.deleted_count, otp_del.deleted_count,
    )
    result["deleted"] = {
        "users": users_del.deleted_count,
        "projects": proj_del.deleted_count,
        "user_sessions": sess_del.deleted_count,
        "email_otps": otp_del.deleted_count,
    }
    return result


# All collections that hold user-generated data, keyed either by project_id
# (children of a project) or by user_id (account-scoped). Used to COMPLETELY
# erase a user + everything they created — no orphaned rows left behind.
_CASCADE_BY_PROJECT = [
    "project_memory", "source_connections", "source_events", "project_updates",
    "notifications", "files", "knowledge_items", "click_events",
]
_CASCADE_BY_USER = [
    "user_sessions", "integration_accounts", "oauth_states", "push_subscriptions",
    "payment_transactions", "connect_previews", "nps_responses", "notifications",
]


async def _cascade_delete_users(victim_ids: List[str], victim_emails: List[str]) -> Dict[str, int]:
    """Fully erase the given users and ALL their data across every collection.
    Deletes children (by project_id and by user_id) before parents."""
    counts: Dict[str, int] = {}
    if not victim_ids:
        return {"users": 0, "projects": 0}

    proj_docs = await db.projects.find(
        {"$or": [{"owner_user_id": {"$in": victim_ids}}, {"creator_email": {"$in": victim_emails}}]},
        {"_id": 0, "id": 1},
    ).to_list(length=100000)
    project_ids = [p["id"] for p in proj_docs if p.get("id")]

    if project_ids:
        for coll in _CASCADE_BY_PROJECT:
            r = await db[coll].delete_many({"project_id": {"$in": project_ids}})
            counts[coll] = counts.get(coll, 0) + r.deleted_count
    for coll in _CASCADE_BY_USER:
        r = await db[coll].delete_many({"user_id": {"$in": victim_ids}})
        counts[coll] = counts.get(coll, 0) + r.deleted_count
    if victim_emails:
        r = await db.email_otps.delete_many({"email": {"$in": victim_emails}})
        counts["email_otps"] = r.deleted_count
    # Detach victim ids from shared session-tracking docs (don't delete shared rows).
    await db.sessions.update_many(
        {"user_ids": {"$in": victim_ids}}, {"$pull": {"user_ids": {"$in": victim_ids}}},
    )
    proj_del = await db.projects.delete_many(
        {"$or": [{"owner_user_id": {"$in": victim_ids}}, {"creator_email": {"$in": victim_emails}}]}
    )
    users_del = await db.users.delete_many({"user_id": {"$in": victim_ids}})
    counts["projects"] = proj_del.deleted_count
    counts["users"] = users_del.deleted_count
    counts.setdefault("user_sessions", 0)
    counts.setdefault("email_otps", 0)
    return counts



class DeleteUsersIn(_BM):
    user_ids: List[str] = _Fd(default_factory=list)
    confirm: bool = _Fd(default=False)


@api.post("/admin/users/delete")
async def admin_delete_users(body: DeleteUsersIn, request: Request):
    """Bulk-delete users by explicit `user_ids` + cascade projects/sessions/OTPs.
    Never deletes admins. Dry-run by default (confirm=True to actually delete)."""
    admin = await auth_current_admin(request, db)
    if not body.user_ids:
        return {"dry_run": True, "matched_users": 0, "deleted": {"users": 0, "projects": 0, "user_sessions": 0, "email_otps": 0}}
    admin_emails_lower = {admin["email"].lower(), *(e.lower() for e in _admin_emails_set())}
    # Fetch victims, skip admins
    victims = await db.users.find(
        {"user_id": {"$in": body.user_ids}},
        {"_id": 0, "user_id": 1, "email": 1},
    ).to_list(length=100000)
    victims = [v for v in victims if (v.get("email") or "").lower() not in admin_emails_lower]
    victim_ids = [v["user_id"] for v in victims]
    victim_emails = [v["email"] for v in victims if v.get("email")]

    if not body.confirm:
        pc = await db.projects.count_documents(
            {"$or": [{"owner_user_id": {"$in": victim_ids}}, {"creator_email": {"$in": victim_emails}}]}
        )
        sc = await db.user_sessions.count_documents({"user_id": {"$in": victim_ids}})
        oc = await db.email_otps.count_documents({"email": {"$in": victim_emails}}) if victim_emails else 0
        return {
            "dry_run": True,
            "matched_users": len(victim_ids),
            "cascade": {"projects": pc, "user_sessions": sc, "email_otps": oc},
        }

    # Cascade delete — completely erase users + ALL their data.
    counts = await _cascade_delete_users(victim_ids, victim_emails)
    logger.info(
        "[admin/users/delete] admin=%s ERASED users=%s projects=%s memory=%s connections=%s notifications=%s sessions=%s",
        admin["email"], counts.get("users", 0), counts.get("projects", 0),
        counts.get("project_memory", 0), counts.get("source_connections", 0),
        counts.get("notifications", 0), counts.get("user_sessions", 0),
    )
    return {
        "dry_run": False,
        "matched_users": len(victim_ids),
        "deleted": {
            "users": counts.get("users", 0),
            "projects": counts.get("projects", 0),
            "user_sessions": counts.get("user_sessions", 0),
            "email_otps": counts.get("email_otps", 0),
        },
        "erased": counts,
    }


@api.post("/admin/purge-guests")
async def admin_purge_guests(request: Request):
    """One-shot: delete ALL guest users (is_guest=True or `*@bracket.guest`)
    across the workspace + cascade their data. Idempotent. Never touches
    non-guest accounts or admins. Used to clean up automation / drive-by
    guest sessions from both preview and production."""
    admin = await auth_current_admin(request, db)
    filt = {"$or": [{"is_guest": True}, {"email": {"$regex": r"@bracket\.guest$"}}]}
    guests = await db.users.find(filt, {"_id": 0, "user_id": 1, "email": 1}).to_list(length=100000)
    ids = [g["user_id"] for g in guests]
    emails = [g["email"] for g in guests if g.get("email")]
    if not ids:
        return {"deleted": {"users": 0, "projects": 0, "user_sessions": 0, "email_otps": 0}}
    counts = await _cascade_delete_users(ids, emails)
    logger.info(
        "[admin/purge-guests] admin=%s ERASED users=%s projects=%s memory=%s connections=%s",
        admin["email"], counts.get("users", 0), counts.get("projects", 0),
        counts.get("project_memory", 0), counts.get("source_connections", 0),
    )
    return {
        "deleted": {
            "users": counts.get("users", 0),
            "projects": counts.get("projects", 0),
            "user_sessions": counts.get("user_sessions", 0),
            "email_otps": counts.get("email_otps", 0),
        },
        "erased": counts,
    }


@api.get("/admin/projects/{project_id}")
async def admin_project_detail(project_id: str, request: Request):
    """Full project document for the admin drill-down. Includes every step's
    input + AI output, share status, feedback, replies. Owner-agnostic (admins
    can view any project). Sensitive fields (share_token) are stripped."""
    await auth_current_admin(request, db)
    p = await db.projects.find_one({"id": project_id}, {"_id": 0, "share_token": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    owner = None
    if p.get("owner_user_id"):
        owner = await db.users.find_one(
            {"user_id": p["owner_user_id"]},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "designation": 1},
        )
    return {"project": p, "owner": owner}


@api.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, body: AdminResetPasswordIn, request: Request):
    admin = await auth_current_admin(request, db)
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1, "user_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_hash = hash_password(body.new_password)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"password_hash": new_hash, "updated_at": auth_iso(auth_now())}},
    )
    # Invalidate ALL of the target's existing sessions so the new password
    # is required immediately. The admin's own session is unaffected.
    await db.user_sessions.delete_many({"user_id": user_id})
    logger.info(f"[admin] {admin['email']} reset password for {target['email']}")
    return {"ok": True, "email": target["email"]}


# ---- ADMIN ANALYTICS -------------------------------------------------------
def _iso_to_dt(s: str):
    """Best-effort ISO -> aware UTC datetime. Returns None on failure."""
    if not s:
        return None
    try:
        from datetime import datetime as _dt, timezone as _tz
        d = _dt.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=_tz.utc)
        return d.astimezone(_tz.utc)
    except Exception:
        return None


@api.get("/admin/pitch-metrics")
async def admin_pitch_metrics(request: Request):
    """Prominent investor-pitch metrics block for the admin panel.

    Returns nine headline numbers (registered users, projects, docs
    shared, client accept rate, WAU, 4-week retention, NPS,
    organic vs paid split, notable users). NPS is auto-computed from
    `nps_responses` when at least one response exists (falls back to the
    manually-set value on `admin_config`). Notable users are always
    curated via the admin_config document.
    """
    from datetime import timedelta as _td
    await auth_current_admin(request, db)
    now = auth_now()
    d7  = now - _td(days=7)
    d28 = now - _td(days=28)

    # --- Computed metrics -------------------------------------------------
    # Registered users — excludes guest accounts (is_guest True).
    registered_users = await db.users.count_documents({
        "$or": [{"is_guest": {"$exists": False}}, {"is_guest": {"$ne": True}}],
    })
    projects_created = await db.projects.count_documents({})
    documents_locked_shared = await db.projects.count_documents({
        "share_status": {"$exists": True, "$nin": [None, "", "none"]},
    })

    accepted = await db.projects.count_documents({"share_status": "accepted"})
    rejected = await db.projects.count_documents({"share_status": "rejected"})
    reviewed = accepted + rejected
    client_accept_rate = round((accepted / reviewed) * 100, 1) if reviewed else 0.0

    wau = await db.users.count_documents({"last_seen_at": {"$gte": auth_iso(d7)}})

    # 4-week retention — cleaner definition: of users who signed up
    # 4+ weeks ago, what % returned in the past 7 days?
    # Gives a real "sticky-user" number instead of the loose 28-day-in-28-day
    # variant that inflated to 100% whenever any active user was old.
    cohort_total = await db.users.count_documents({"created_at": {"$lte": auth_iso(d28)}})
    cohort_active = await db.users.count_documents({
        "created_at":   {"$lte": auth_iso(d28)},
        "last_seen_at": {"$gte": auth_iso(d7)},
    })
    retention_4w = round((cohort_active / cohort_total) * 100, 1) if cohort_total else 0.0

    # Organic vs paid split — derived from acquisition sessions.
    # A session is "paid" when utm_medium contains cpc/paid/ad or the
    # source bucket is explicitly "paid_search" / "paid_social".
    paid_sessions = await db.sessions.count_documents({
        "$or": [
            {"utm_medium": {"$regex": "cpc|paid|ad", "$options": "i"}},
            {"source_bucket": {"$in": ["paid_search", "paid_social", "paid"]}},
        ],
    })
    total_sessions = await db.sessions.count_documents({})
    organic_sessions = max(total_sessions - paid_sessions, 0)
    organic_pct = round((organic_sessions / total_sessions) * 100, 1) if total_sessions else 0.0
    paid_pct    = round((paid_sessions / total_sessions) * 100, 1) if total_sessions else 0.0

    # --- Connect-tools philosophy: work tools connected + memory captured -
    # Bracket's core loop is connecting external work sources (Gmail, Slack,
    # Figma, GitHub…) and auto-extracting project memory. These are the
    # metrics that actually reflect the product delivering value.
    _real_src = {}
    sources_connected = await db.source_connections.count_documents(_real_src)
    memory_items_extracted = await db.project_memory.count_documents({})
    _connected_pids = await db.source_connections.distinct("project_id", _real_src)
    projects_with_source = len(_connected_pids)
    pct_projects_connected = round((projects_with_source / projects_created) * 100, 1) if projects_created else 0.0
    avg_sources_per_project = round(sources_connected / projects_with_source, 2) if projects_with_source else 0.0
    avg_memory_per_project = round(memory_items_extracted / projects_with_source, 1) if projects_with_source else 0.0

    # --- Admin-editable fields (notable users) ---------------------------
    cfg = await db.admin_config.find_one({"_id": "pitch_metrics"}) or {}
    manual_nps = cfg.get("nps")  # int/float or None
    notable_users = cfg.get("notable_users") or []  # [{name, role, logo_url}]
    # Sanitize notable users to safe shape.
    clean_notables = []
    for n in notable_users[:12]:
        if not isinstance(n, dict):
            continue
        clean_notables.append({
            "name":     str(n.get("name") or "").strip()[:80],
            "role":     str(n.get("role") or "").strip()[:120],
            "logo_url": str(n.get("logo_url") or "").strip()[:400],
        })

    # --- Auto-compute NPS from `nps_responses` when we have data --------
    # NPS = %promoters (9-10) − %detractors (0-6). Passives (7-8) don't count.
    nps_total = await db.nps_responses.count_documents({})
    nps_promoters = await db.nps_responses.count_documents({"score": {"$gte": 9}})
    nps_detractors = await db.nps_responses.count_documents({"score": {"$lte": 6}})
    nps_computed: Optional[float] = None
    if nps_total > 0:
        nps_computed = round(
            ((nps_promoters - nps_detractors) / nps_total) * 100, 1
        )
    nps = nps_computed if nps_computed is not None else manual_nps
    nps_source = (
        "responses" if nps_computed is not None
        else ("manual" if manual_nps is not None else "none")
    )

    return {
        "registered_users":        registered_users,
        "projects_created":        projects_created,
        "documents_locked_shared": documents_locked_shared,
        "sources_connected":       sources_connected,
        "memory_items_extracted":  memory_items_extracted,
        "projects_with_source":    projects_with_source,
        "pct_projects_connected":  pct_projects_connected,
        "avg_sources_per_project": avg_sources_per_project,
        "avg_memory_per_project":  avg_memory_per_project,
        "client_accept_rate":      client_accept_rate,
        "weekly_active_users":     wau,
        "retention_4w":            retention_4w,
        "nps":                     nps,
        "nps_source":              nps_source,       # "responses" | "manual" | "none"
        "nps_responses_count":     nps_total,
        "nps_promoters":           nps_promoters,
        "nps_detractors":          nps_detractors,
        "organic_paid_split":      {
            "organic_pct":     organic_pct,
            "paid_pct":        paid_pct,
            "organic":         organic_sessions,
            "paid":            paid_sessions,
            "total_sessions":  total_sessions,
        },
        "notable_users": clean_notables,
        # --- Product signals block ------------------------------------
        "product_signals": await _compute_product_signals(db, d7, d28),
        "generated_at":  auth_iso(now),
    }


async def _compute_product_signals(db, d7, d28) -> Dict[str, Any]:
    """Activation + engagement + retention metrics for the pitch board.
    Kept in a helper because the pitch endpoint is already large."""
    now_dt = auth_now()

    # --- Time signup → first project (per user, then average) ---------
    minutes_list: list = []
    activated_10min = 0
    users_with_project = 0
    total_users_for_activation = 0
    async for u in db.users.find(
        {"$or": [{"is_guest": {"$exists": False}}, {"is_guest": {"$ne": True}}]},
        {"_id": 0, "user_id": 1, "created_at": 1},
    ):
        total_users_for_activation += 1
        uc = _iso_to_dt(u.get("created_at"))
        if not uc:
            continue
        first_project = await db.projects.find_one(
            {"owner_user_id": u["user_id"]},
            sort=[("created_at", 1)],
            projection={"_id": 0, "created_at": 1},
        )
        if not first_project:
            continue
        pc = _iso_to_dt(first_project.get("created_at"))
        if not pc:
            continue
        delta_min = max(0, (pc - uc).total_seconds() / 60.0)
        minutes_list.append(delta_min)
        users_with_project += 1
        if delta_min <= 10:
            activated_10min += 1

    avg_signup_to_first_doc_minutes: Optional[float] = None
    if minutes_list:
        avg_signup_to_first_doc_minutes = round(sum(minutes_list) / len(minutes_list), 1)
    pct_activated_10min = round((activated_10min / total_users_for_activation) * 100, 1) if total_users_for_activation else 0.0

    # --- Avg projects per active user (active in past 7d) -------------
    active_7d = await db.users.count_documents({"last_seen_at": {"$gte": auth_iso(d7)}})
    total_projects = await db.projects.count_documents({})
    avg_projects_per_active_user = round(total_projects / active_7d, 2) if active_7d else 0.0

    # --- Returning users (came back after signup week) ---------------
    # Definition: users whose signup was >7d ago AND who have last_seen_at
    # in the past 7 (or 30) days.
    returning_7d = await db.users.count_documents({
        "created_at":   {"$lt":  auth_iso(d7)},
        "last_seen_at": {"$gte": auth_iso(d7)},
    })
    returning_30d = await db.users.count_documents({
        "created_at":   {"$lt":  auth_iso(d28)},
        "last_seen_at": {"$gte": auth_iso(d28)},
    })

    # --- Avg session duration (Python-side compute for portability) ---
    total_secs = 0.0
    session_duration_count = 0
    async for s in db.sessions.find(
        {"first_seen_at": {"$exists": True}, "last_seen_at": {"$exists": True}},
        {"_id": 0, "first_seen_at": 1, "last_seen_at": 1},
    ):
        f = _iso_to_dt(s.get("first_seen_at"))
        l = _iso_to_dt(s.get("last_seen_at"))
        if not f or not l:
            continue
        diff = (l - f).total_seconds()
        if diff < 0:
            continue
        total_secs += diff
        session_duration_count += 1
    avg_session_duration_seconds = round(total_secs / session_duration_count, 1) if session_duration_count else 0.0

    # --- Connect-tools activation: did users actually connect a work tool? -
    _real_src = {}
    sources_connected = await db.source_connections.count_documents(_real_src)
    memory_items_extracted = await db.project_memory.count_documents({})
    _connected_pids = await db.source_connections.distinct("project_id", _real_src)
    projects_with_source = len(_connected_pids)
    avg_sources_per_project = round(sources_connected / projects_with_source, 2) if projects_with_source else 0.0
    avg_memory_per_project = round(memory_items_extracted / projects_with_source, 1) if projects_with_source else 0.0
    pct_projects_connected = round(projects_with_source / total_projects * 100, 1) if total_projects else 0.0
    _owners = set()
    if _connected_pids:
        async for p in db.projects.find({"id": {"$in": _connected_pids}}, {"_id": 0, "owner_user_id": 1}):
            _owners.add(p.get("owner_user_id"))
    pct_users_connected_source = round(len(_owners) / total_users_for_activation * 100, 1) if total_users_for_activation else 0.0

    return {
        "avg_signup_to_first_doc_minutes":  avg_signup_to_first_doc_minutes,
        "users_with_first_doc":             users_with_project,
        "pct_activated_10min":              pct_activated_10min,
        "activated_10min_count":            activated_10min,
        "avg_projects_per_active_user":     avg_projects_per_active_user,
        "active_users_7d":                  active_7d,
        "total_projects_for_avg":           total_projects,
        "returning_users_7d":               returning_7d,
        "returning_users_30d":              returning_30d,
        "avg_session_duration_seconds":     avg_session_duration_seconds,
        "session_duration_sample_size":     session_duration_count,
        # Connect-tools philosophy
        "sources_connected":                sources_connected,
        "memory_items_extracted":           memory_items_extracted,
        "avg_sources_per_project":          avg_sources_per_project,
        "avg_memory_per_project":           avg_memory_per_project,
        "pct_projects_connected":           pct_projects_connected,
        "pct_users_connected_source":       pct_users_connected_source,
    }


class PitchMetricsConfigIn(_BM):
    nps: Optional[float] = None
    notable_users: Optional[List[Dict[str, Any]]] = None


@api.put("/admin/pitch-metrics/config")
async def admin_pitch_metrics_config(body: PitchMetricsConfigIn, request: Request):
    """Save the two manually-curated pitch fields — NPS (a number the
    founder collects out-of-band) and the notable-users list (name,
    role/company, logo URL). All fields optional; partial updates OK."""
    await auth_current_admin(request, db)
    update: Dict[str, Any] = {"updated_at": auth_iso(auth_now())}
    if body.nps is not None:
        try:
            n = float(body.nps)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="NPS must be a number.")
        if not -100.0 <= n <= 100.0:
            raise HTTPException(status_code=400, detail="NPS must be between -100 and 100.")
        update["nps"] = round(n, 1)
    if body.notable_users is not None:
        clean = []
        for n in (body.notable_users or [])[:12]:
            if not isinstance(n, dict):
                continue
            name = str(n.get("name") or "").strip()[:80]
            if not name:
                continue
            clean.append({
                "name":     name,
                "role":     str(n.get("role") or "").strip()[:120],
                "logo_url": str(n.get("logo_url") or "").strip()[:400],
            })
        update["notable_users"] = clean
    await db.admin_config.update_one(
        {"_id": "pitch_metrics"},
        {"$set": update},
        upsert=True,
    )
    return {"ok": True}


# ===========================================================================
# WEBSITE ANALYTICS — traffic + geo + click heatmap, all range-filterable
# ===========================================================================
# Range presets accepted by the analytics endpoints. "lifetime" = no filter.
_RANGE_PRESETS = {
    "yesterday":  1,   # rolling last 24h (calendar-yesterday variant handled in caller)
    "7d":         7,
    "30d":        30,
    "90d":        90,
    "lifetime":   None,
}


def _range_iso_since(range_key: str) -> Optional[str]:
    """Convert a range preset to a lower-bound ISO timestamp, or None
    when the range is `lifetime` (no lower bound)."""
    from datetime import timedelta as _td
    days = _RANGE_PRESETS.get(range_key or "lifetime")
    if days is None:
        return None
    return auth_iso(auth_now() - _td(days=days))


@api.get("/admin/website-analytics")
async def admin_website_analytics(request: Request, range: str = "lifetime"):
    """Traffic + geo dashboard with range filter.

    Query params:
      - range: yesterday | 7d | 30d | 90d | lifetime
    """
    await auth_current_admin(request, db)
    range_key = range if range in _RANGE_PRESETS else "lifetime"
    since = _range_iso_since(range_key)
    match: Dict[str, Any] = {}
    if since is not None:
        match["last_seen_at"] = {"$gte": since}

    # --- Traffic KPIs ---------------------------------------------------
    total_sessions = await db.sessions.count_documents(match)
    # Unique visitors — count distinct session_ids matching the range.
    # (session_id is unique per browser install, effectively per visitor.)
    unique_visitors = total_sessions  # session_id ↔ session doc is 1:1
    # Page views — sum of page_views across matching sessions.
    total_page_views = 0
    async for row in db.sessions.aggregate([
        {"$match": match},
        {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$page_views", 1]}}}},
    ]):
        total_page_views = int(row.get("s") or 0)

    # Logged-in visits — sessions with at least one real (non-anon) user_id.
    logged_in = await db.sessions.count_documents({
        **match,
        "user_ids": {"$elemMatch": {"$not": {"$regex": "^__anon__$"}}},
    }) if match else await db.sessions.count_documents({
        "user_ids": {"$elemMatch": {"$not": {"$regex": "^__anon__$"}}},
    })

    # --- Sessions per day (line series) ---------------------------------
    daily = []
    day_agg: Dict[str, int] = {}
    async for row in db.sessions.aggregate([
        {"$match": match} if match else {"$match": {}},
        {"$project": {"day": {"$substr": ["$last_seen_at", 0, 10]}}},
        {"$group": {"_id": "$day", "n": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]):
        day_agg[row["_id"]] = row["n"]
    for day in sorted(day_agg):
        daily.append({"date": day, "sessions": day_agg[day]})

    # --- Top pages (page views by path) --------------------------------
    top_pages = []
    async for row in db.sessions.aggregate([
        {"$match": {**match, "last_path": {"$exists": True, "$ne": ""}}},
        {"$group": {"_id": "$last_path", "sessions": {"$sum": 1}, "views": {"$sum": {"$ifNull": ["$page_views", 1]}}}},
        {"$sort": {"views": -1}},
        {"$limit": 15},
    ]):
        top_pages.append({"path": row["_id"], "sessions": row["sessions"], "views": row["views"]})

    # --- Top sources / referrers ---------------------------------------
    top_sources = []
    async for row in db.sessions.aggregate([
        {"$match": {**match, "source_bucket": {"$ne": ""}}},
        {"$group": {"_id": "$source_bucket", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]):
        top_sources.append({"source": row["_id"], "sessions": row["n"]})

    # --- Geo — resolved country per session, joined via geoip_cache ----
    # Two-step: pull the distinct IPs in-range, look up their countries.
    ips_in_range: list = []
    async for row in db.sessions.aggregate([
        {"$match": {**match, "ip": {"$exists": True, "$ne": ""}}},
        {"$group": {"_id": "$ip", "n": {"$sum": 1}}},
    ]):
        ips_in_range.append({"ip": row["_id"], "sessions": row["n"]})

    country_counts: Dict[str, Dict[str, Any]] = {}
    if ips_in_range:
        ip_list = [x["ip"] for x in ips_in_range]
        geo_by_ip: Dict[str, Dict[str, Any]] = {}
        async for g in db.geoip_cache.find({"_id": {"$in": ip_list}}, {"_id": 1, "country": 1, "countryCode": 1, "lat": 1, "lon": 1}):
            geo_by_ip[g["_id"]] = g
        for item in ips_in_range:
            g = geo_by_ip.get(item["ip"])
            code = (g or {}).get("countryCode") or "??"
            name = (g or {}).get("country") or ("Unknown" if code == "??" else code)
            bucket = country_counts.setdefault(code, {
                "code": code, "country": name, "sessions": 0, "lat": (g or {}).get("lat"), "lon": (g or {}).get("lon"),
            })
            bucket["sessions"] += item["sessions"]
    countries = sorted(country_counts.values(), key=lambda x: -x["sessions"])[:50]
    unresolved_ips = sum(1 for c in countries if c["code"] == "??")

    return {
        "range":                 range_key,
        "since":                 since,
        "generated_at":          auth_iso(auth_now()),
        "traffic": {
            "total_sessions":    total_sessions,
            "unique_visitors":   unique_visitors,
            "total_page_views":  total_page_views,
            "logged_in_visits":  logged_in,
        },
        "daily":                 daily,
        "top_pages":             top_pages,
        "top_sources":           top_sources,
        "countries":             countries,
        "unresolved_ips":        unresolved_ips,
    }


@api.get("/admin/heatmap/pages")
async def admin_heatmap_pages(request: Request, range: str = "lifetime"):
    """List the pages that have click events, most clicks first — user
    picks one to see its full click heatmap."""
    await auth_current_admin(request, db)
    since = _range_iso_since(range if range in _RANGE_PRESETS else "lifetime")
    match: Dict[str, Any] = {}
    if since is not None:
        match["created_at"] = {"$gte": since}
    pages: list = []
    async for row in db.click_events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$path", "clicks": {"$sum": 1}}},
        {"$sort": {"clicks": -1}},
        {"$limit": 30},
    ]):
        pages.append({"path": row["_id"] or "/", "clicks": row["clicks"]})
    return {"pages": pages, "range": range}


@api.get("/admin/heatmap")
async def admin_heatmap(request: Request, path: str = "/", range: str = "lifetime"):
    """Return every click event on a given path — the frontend renders a
    density heatmap over a screenshot / blank canvas at 1440×900."""
    await auth_current_admin(request, db)
    since = _range_iso_since(range if range in _RANGE_PRESETS else "lifetime")
    match: Dict[str, Any] = {"path": path}
    if since is not None:
        match["created_at"] = {"$gte": since}
    events: list = []
    async for row in db.click_events.find(match, {"_id": 0, "x_frac": 1, "y_frac": 1, "vp_w": 1, "vp_h": 1, "tag": 1, "created_at": 1}).sort("created_at", -1).limit(5000):
        events.append(row)
    return {"path": path, "range": range, "count": len(events), "events": events}


# ===========================================================================
# PUBLISH-EVENT LOG + BEFORE/AFTER COMPARISON
# ===========================================================================
class PublishEventIn(_BM):
    name: str = _Fd(min_length=2, max_length=120)
    description: str = _Fd(default="", max_length=800)
    # Optional ISO timestamp — defaults to "now" if omitted.
    published_at: Optional[str] = None


@api.get("/admin/publishes")
async def admin_list_publishes(request: Request):
    """Recent publish events, newest first."""
    await auth_current_admin(request, db)
    rows: list = []
    async for r in db.publish_events.find({}, {"_id": 0}).sort("published_at", -1).limit(40):
        rows.append(r)
    return {"publishes": rows}


@api.post("/admin/publishes")
async def admin_create_publish(body: PublishEventIn, request: Request):
    """Log a deployment/publish for later before/after comparison."""
    admin = await auth_current_admin(request, db)
    published_at = body.published_at or auth_iso(auth_now())
    doc = {
        "id":            _uuid(),
        "name":          body.name.strip()[:120],
        "description":   (body.description or "").strip()[:800],
        "published_at":  published_at,
        "created_by":    admin["email"],
        "created_at":    auth_iso(auth_now()),
    }
    await db.publish_events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/admin/publishes/{publish_id}")
async def admin_delete_publish(publish_id: str, request: Request):
    await auth_current_admin(request, db)
    r = await db.publish_events.delete_one({"id": publish_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Publish not found.")
    return {"ok": True}


async def _metrics_in_window(db, start_iso: str, end_iso: str) -> Dict[str, Any]:
    """Compute a compact funnel + engagement snapshot within [start, end).

    Funnel definitions (matches the mature product-team playbook):
      - Visitor → Signup    = new_signups / sessions × 100
      - Signup → 1st Project = of users who signed up IN window, how many
                                have a project (any time). Approximates the
                                onboarding activation rate.
      - 1st Project → Locked  = of projects created IN window, how many
                                reached share_status ≠ 'none' (any time).
    """
    match_range = {"$gte": start_iso, "$lt": end_iso}

    total_sessions = await db.sessions.count_documents({"last_seen_at": match_range})
    page_views = 0
    async for row in db.sessions.aggregate([
        {"$match": {"last_seen_at": match_range}},
        {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$page_views", 1]}}}},
    ]):
        page_views = int(row.get("s") or 0)

    new_signups = await db.users.count_documents({
        "created_at": match_range,
        "$or": [{"is_guest": {"$exists": False}}, {"is_guest": {"$ne": True}}],
    })
    new_projects = await db.projects.count_documents({"created_at": match_range})

    # Projects created in window → locked/shared (any time later)
    locked_from_window = await db.projects.count_documents({
        "created_at": match_range,
        "share_status": {"$exists": True, "$nin": [None, "", "none"]},
    })

    # Signups in window → who has at least one project (any time)
    signups_with_project = 0
    time_to_first_mins: list = []
    step_values: list = []
    async for u in db.users.find({
        "created_at": match_range,
        "$or": [{"is_guest": {"$exists": False}}, {"is_guest": {"$ne": True}}],
    }, {"_id": 0, "user_id": 1, "created_at": 1}):
        first_p = await db.projects.find_one(
            {"owner_user_id": u["user_id"]},
            sort=[("created_at", 1)],
            projection={"_id": 0, "created_at": 1, "step": 1},
        )
        if first_p:
            signups_with_project += 1
            uc = _iso_to_dt(u.get("created_at"))
            pc = _iso_to_dt(first_p.get("created_at"))
            if uc and pc:
                time_to_first_mins.append(max(0, (pc - uc).total_seconds() / 60.0))
    # Avg steps completed for projects created in window
    async for p in db.projects.find({"created_at": match_range}, {"_id": 0, "step": 1}):
        try:
            step_values.append(int(p.get("step") or 0))
        except (TypeError, ValueError):
            pass

    def _rate(num, denom):
        return round((num / denom) * 100, 1) if denom else None

    def _avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    accepted = await db.projects.count_documents({"share_status": "accepted", "updated_at": match_range})
    rejected = await db.projects.count_documents({"share_status": "rejected", "updated_at": match_range})
    reviewed = accepted + rejected
    nps_responses = await db.nps_responses.count_documents({"updated_at": match_range})

    return {
        "start":                     start_iso,
        "end":                       end_iso,
        "sessions":                  total_sessions,
        "page_views":                page_views,
        "new_signups":               new_signups,
        "new_projects":              new_projects,
        "docs_shared":               locked_from_window,
        "client_accept_rate":        _rate(accepted, reviewed),
        "nps_responses":             nps_responses,
        # Funnel rates
        "visitor_to_signup_pct":     _rate(new_signups, total_sessions),
        "signup_to_first_project_pct": _rate(signups_with_project, new_signups),
        "project_to_locked_pct":     _rate(locked_from_window, new_projects),
        # Engagement
        "avg_time_to_first_doc_min": _avg(time_to_first_mins),
        "avg_steps_completed":       _avg(step_values),
    }


def _pct_change(before, after) -> Optional[float]:
    if before is None or after is None:
        return None
    try:
        b = float(before)
        a = float(after)
    except (TypeError, ValueError):
        return None
    if b == 0:
        return None if a == 0 else 100.0
    return round(((a - b) / b) * 100, 1)


@api.get("/admin/publishes/{publish_id}/compare")
async def admin_compare_publish(publish_id: str, request: Request, window_days: int = 14):
    """Compare metrics from the `window_days` before vs after a publish
    (default 14 days — the minimum recommended window for small user bases
    to smooth out day-to-day variation)."""
    from datetime import timedelta as _td
    await auth_current_admin(request, db)
    window_days = max(1, min(window_days, 90))
    pub = await db.publish_events.find_one({"id": publish_id}, {"_id": 0})
    if not pub:
        raise HTTPException(status_code=404, detail="Publish not found.")
    at = _iso_to_dt(pub["published_at"])
    if not at:
        raise HTTPException(status_code=400, detail="Publish has an invalid timestamp.")
    before_start = auth_iso(at - _td(days=window_days))
    before_end   = auth_iso(at)
    after_start  = auth_iso(at)
    after_end_dt = at + _td(days=window_days)
    now = auth_now()
    if after_end_dt > now:
        after_end_dt = now
    after_end    = auth_iso(after_end_dt)

    before = await _metrics_in_window(db, before_start, before_end)
    after  = await _metrics_in_window(db, after_start, after_end)

    # Compute exact window lengths (fractional days) — used to normalize sum
    # metrics per-day. Without this, comparing a 60d "before" window to a 4d
    # "after" window is meaningless. Ratios/averages stay as-is because they
    # are already normalized by construction.
    _b_start_dt = _iso_to_dt(before_start)
    _b_end_dt   = _iso_to_dt(before_end)
    _a_start_dt = _iso_to_dt(after_start)
    _a_end_dt   = _iso_to_dt(after_end)
    before_days = max((_b_end_dt - _b_start_dt).total_seconds() / 86400.0, 1e-6) if (_b_start_dt and _b_end_dt) else float(window_days)
    after_days  = max((_a_end_dt - _a_start_dt).total_seconds() / 86400.0, 1e-6) if (_a_start_dt and _a_end_dt) else float(window_days)

    _SUM_KEYS = {"sessions", "page_views", "new_signups", "new_projects", "docs_shared", "nps_responses"}

    def _per_day(k, raw, days):
        if k not in _SUM_KEYS:
            return raw
        if not isinstance(raw, (int, float)):
            return raw
        return round(raw / days, 2)

    keys_labels = [
        ("visitor_to_signup_pct",       "Visitor → Signup (%)",             "pct"),
        ("signup_to_first_project_pct", "Signup → First Project (%)",       "pct"),
        ("project_to_locked_pct",       "First Project → Locked Doc (%)",   "pct"),
        ("avg_time_to_first_doc_min",   "Avg time to first doc (min)",      "lower_better"),
        ("avg_steps_completed",         "Avg steps completed",              "num"),
        ("sessions",                    "Sessions / day",                   "per_day"),
        ("page_views",                  "Page views / day",                 "per_day"),
        ("new_signups",                 "New signups / day",                "per_day"),
        ("new_projects",                "New projects / day",               "per_day"),
        ("docs_shared",                 "Docs locked & shared / day",       "per_day"),
        ("client_accept_rate",          "Client accept rate (%)",           "pct"),
        ("nps_responses",               "NPS responses / day",              "per_day"),
    ]
    deltas = []
    for (k, lbl, kind) in keys_labels:
        b_norm = _per_day(k, before.get(k), before_days)
        a_norm = _per_day(k, after.get(k), after_days)
        deltas.append({
            "key":         k,
            "label":       lbl,
            "kind":        kind,
            "before":      b_norm,
            "after":       a_norm,
            "before_raw":  before.get(k),
            "after_raw":   after.get(k),
            "pct_change":  _pct_change(b_norm, a_norm),
        })

    return {
        "publish":       pub,
        "window_days":   window_days,
        "before_window": {"start": before_start, "end": before_end, "days": round(before_days, 2)},
        "after_window":  {"start": after_start,  "end": after_end,  "days": round(after_days, 2)},
        "before":        before,
        "after":         after,
        "deltas":        deltas,
    }


# ===========================================================================
# NPS SURVEY CAMPAIGN
# ===========================================================================
NPS_SECRET_KEY = os.environ.get("JWT_SECRET") or os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or "bracket-nps-signing-key"


def _nps_token(user_id: str) -> str:
    """HMAC token binding a user_id to a survey click. Prevents randoms from
    ballot-stuffing the NPS score. First 16 hex chars of HMAC-SHA256 is plenty."""
    import hmac as _hmac
    import hashlib as _hash
    mac = _hmac.new(NPS_SECRET_KEY.encode(), user_id.encode(), _hash.sha256)
    return mac.hexdigest()[:16]


def _nps_public_base_url(request: Request) -> str:
    """Prefer PUBLIC_BASE_URL env, fall back to the request's host so tokens
    still land on the same origin in the preview environment."""
    env = (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if env:
        return env
    return f"{request.url.scheme}://{request.url.netloc}".rstrip("/")


class SendNpsCampaignIn(_BM):
    # When True, sends only to the currently-signed-in admin — safe smoke test.
    test_only: bool = False
    # When True, re-sends to users who already have a nps_responses entry.
    include_answered: bool = False


@api.post("/admin/nps/send-campaign")
async def admin_send_nps_campaign(body: SendNpsCampaignIn, request: Request):
    """Send the NPS survey email to every registered user (excludes guests).

    Cool-down removed per admin request — the admin decides when to send
    the next campaign from the panel. Fire-and-forget: kicks off a
    background task that incrementally updates the nps_campaigns doc
    (queued/sent/failed/status) so the admin UI can render a live
    progress bar.
    """
    admin = await auth_current_admin(request, db)

    base_url = _nps_public_base_url(request)
    logo_url = f"{base_url}/logo-diamond.png"

    query: Dict[str, Any] = {
        "$or": [{"is_guest": {"$exists": False}}, {"is_guest": {"$ne": True}}],
        "email": {"$type": "string", "$ne": ""},
    }
    if body.test_only:
        query["user_id"] = admin["user_id"]

    excluded_user_ids: set = set()
    if not body.include_answered:
        cur = db.nps_responses.find({}, {"_id": 0, "user_id": 1})
        async for r in cur:
            if r.get("user_id"):
                excluded_user_ids.add(r["user_id"])

    targets: list = []
    async for u in db.users.find(query, {"_id": 0, "user_id": 1, "email": 1, "name": 1}):
        if u.get("user_id") in excluded_user_ids:
            continue
        if u.get("email"):
            targets.append(u)

    # Insert campaign doc UP FRONT so the UI can immediately poll progress.
    campaign_id = _uuid()
    now_iso = auth_iso(auth_now())
    await db.nps_campaigns.insert_one({
        "id":            campaign_id,
        "started_by":    admin["email"],
        "targeted":      len(targets),
        "queued":        len(targets),
        "sent":          0,
        "failed":        0,
        "status":        "running" if targets else "completed",
        "test_only":     body.test_only,
        "include_answered": body.include_answered,
        "started_at":    now_iso,
        "updated_at":    now_iso,
        "completed_at":  None if targets else now_iso,
    })

    async def _campaign():
        sent = 0
        failed = 0
        remaining = len(targets)
        for u in targets:
            try:
                ok = await send_nps_survey_email(
                    to_email=u["email"],
                    name=u.get("name") or "",
                    user_id=u["user_id"],
                    token=_nps_token(u["user_id"]),
                    public_base_url=base_url,
                    logo_url=logo_url,
                )
                if ok:
                    sent += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning("nps campaign send failed for %s: %s", u.get("email"), e)
                failed += 1
            remaining -= 1
            # Progress ping every 5 sends (or on the last one).
            if remaining == 0 or (sent + failed) % 5 == 0:
                try:
                    await db.nps_campaigns.update_one(
                        {"id": campaign_id},
                        {"$set": {
                            "sent":       sent,
                            "failed":     failed,
                            "queued":     max(remaining, 0),
                            "updated_at": auth_iso(auth_now()),
                        }},
                    )
                except Exception as e:
                    logger.warning("nps campaign progress write failed: %s", e)
            await asyncio.sleep(0.35)
        try:
            await db.nps_campaigns.update_one(
                {"id": campaign_id},
                {"$set": {
                    "sent":         sent,
                    "failed":       failed,
                    "queued":       0,
                    "status":       "completed",
                    "completed_at": auth_iso(auth_now()),
                    "updated_at":   auth_iso(auth_now()),
                }},
            )
        except Exception as e:
            logger.warning("nps campaign final write failed: %s", e)
        logger.info("nps campaign %s complete: %d sent, %d failed (of %d)", campaign_id, sent, failed, len(targets))

    asyncio.create_task(_campaign())

    return {
        "ok": True,
        "campaign_id": campaign_id,
        "targeted": len(targets),
        "test_only": body.test_only,
        "include_answered": body.include_answered,
        "message": (
            f"Queued {len(targets)} email(s). Delivery runs in the background — "
            f"watch the progress bar below."
        ),
    }


@api.get("/admin/nps/detail")
async def admin_nps_detail(request: Request):
    """Full NPS panel data: campaign history w/ live progress, cool-down
    remaining, score histogram, response rate, latest comments."""
    from datetime import timedelta as _td
    await auth_current_admin(request, db)

    campaigns: list = []
    async for c in db.nps_campaigns.find({}, {"_id": 0}).sort("started_at", -1).limit(30):
        campaigns.append(c)

    latest_full = next((c for c in campaigns if not c.get("test_only")), None)
    # Cool-down was removed at admin request — the button is always live.
    # We still expose seconds-since-last for display purposes, but leave
    # the "remaining" at zero so the frontend never disables the CTA.
    cooldown_remaining_seconds = 0
    seconds_since_last_campaign: Optional[int] = None
    if latest_full:
        started = _iso_to_dt(latest_full.get("started_at"))
        if started:
            seconds_since_last_campaign = max(0, int((auth_now() - started).total_seconds()))

    histogram = [{"score": s, "count": 0} for s in range(11)]
    async for row in db.nps_responses.aggregate([
        {"$group": {"_id": "$score", "n": {"$sum": 1}}},
    ]):
        s = row.get("_id")
        if isinstance(s, int) and 0 <= s <= 10:
            histogram[s]["count"] = row["n"]

    total_responses = sum(b["count"] for b in histogram)
    promoters  = sum(b["count"] for b in histogram if b["score"] >= 9)
    passives   = sum(b["count"] for b in histogram if 7 <= b["score"] <= 8)
    detractors = sum(b["count"] for b in histogram if b["score"] <= 6)
    nps_score = round(((promoters - detractors) / total_responses) * 100, 1) if total_responses else None

    total_sent_agg = 0
    async for row in db.nps_campaigns.aggregate([
        {"$match": {"test_only": {"$ne": True}}},
        {"$group": {"_id": None, "s": {"$sum": "$sent"}}},
    ]):
        total_sent_agg = int(row.get("s") or 0)
    response_rate = round((total_responses / total_sent_agg) * 100, 1) if total_sent_agg else 0.0

    latest_responses: list = []
    async for r in db.nps_responses.find(
        {}, {"_id": 0, "id": 1, "score": 1, "score_bucket": 1, "comment": 1, "name": 1, "updated_at": 1}
    ).sort("updated_at", -1).limit(20):
        raw_name = (r.get("name") or "").strip()
        first = raw_name.split(" ")[0][:24] if raw_name else "Anonymous"
        latest_responses.append({
            "id": r.get("id"),
            "score": r.get("score"),
            "score_bucket": r.get("score_bucket") or "",
            "comment": (r.get("comment") or "")[:600],
            "name": first,
            "updated_at": r.get("updated_at") or "",
        })

    return {
        "campaigns":                    campaigns,
        "cooldown_remaining_seconds":   cooldown_remaining_seconds,
        "seconds_since_last_campaign":  seconds_since_last_campaign,
        "histogram":                    histogram,
        "totals": {
            "responses":  total_responses,
            "promoters":  promoters,
            "passives":   passives,
            "detractors": detractors,
            "nps":        nps_score,
        },
        "response_rate":                response_rate,
        "total_sent":                   total_sent_agg,
        "latest_responses":             latest_responses,
        "generated_at":                 auth_iso(auth_now()),
    }


@api.get("/admin/nps/campaigns")
async def admin_list_nps_campaigns(request: Request):
    """Recent NPS campaign runs, most recent first — for the admin UI."""
    await auth_current_admin(request, db)
    out = []
    async for row in db.nps_campaigns.find({}, {"_id": 0}).sort("started_at", -1).limit(20):
        out.append(row)
    return {"campaigns": out}


# ---- Public NPS submission (tap a button in the email) --------------------
def _nps_thankyou_html(score: int, response_id: str, public_base_url: str, done: bool = False) -> str:
    """Rendered on GET after a user taps a score in their email, and again
    after they submit an optional comment (done=True)."""
    if score <= 6:
        headline_color = "#EF4444"
        prompt = "Something's off. Tell us the one thing that would fix it."
        chip = "Thanks for the honest read"
    elif score <= 8:
        headline_color = "#F59E0B"
        prompt = "So close. What's the one thing that would push you to a 9 or 10?"
        chip = "Noted — thank you"
    else:
        headline_color = "#22C55E"
        prompt = "You made our week. What worked well for you?"
        chip = "Thank you"
    safe_response_id = response_id.replace("<", "&lt;").replace(">", "&gt;")
    submit_action = f"{public_base_url}/api/nps/comment"
    done_block = (
        '<p style="margin:32px 0 0 0;font-size:15.5px;line-height:1.6;color:#22C55E;text-align:center;">'
        'Got it — thank you.</p>'
        '<p style="margin:8px 0 0 0;font-size:13px;line-height:1.6;color:#8A93A0;text-align:center;">'
        'You can close this tab.</p>'
        if done else
        f'<form method="post" action="{submit_action}" style="margin-top:24px;">'
        f'<input type="hidden" name="response_id" value="{safe_response_id}"/>'
        f'<label style="display:block;font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:10.5px;'
        f'letter-spacing:0.18em;text-transform:uppercase;color:#8A93A0;margin-bottom:8px;">'
        f'{prompt}</label>'
        f'<textarea name="comment" rows="4" placeholder="Write anything… we read every one." '
        f'style="width:100%;padding:14px 16px;background:#0F1114;color:#F4F5F7;border:1px solid #26282D;'
        f'border-radius:12px;font-family:\'Poppins\',sans-serif;font-size:14.5px;line-height:1.55;'
        f'outline:none;resize:vertical;box-sizing:border-box;"></textarea>'
        f'<button type="submit" style="margin-top:12px;padding:11px 22px;background:#5E6AD2;color:#fff;'
        f'border:0;border-radius:10px;font-family:\'Poppins\',sans-serif;font-size:13.5px;font-weight:600;'
        f'letter-spacing:0.01em;cursor:pointer;">Send &rarr;</button>'
        f'</form>'
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"/><title>Bracket · Thank you</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="{public_base_url}/favicon.svg"/>
</head>
<body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;min-height:100vh;">
<div style="max-width:520px;margin:0 auto;padding:64px 20px 40px 20px;">
  <div style="text-align:center;">
    <img src="{public_base_url}/logo-diamond.png" alt="Bracket" width="44" height="44" style="display:inline-block;"/>
    <p style="margin:14px 0 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">
      &lt; bracket &middot; {chip.lower()} &gt;
    </p>
    <div style="margin:18px 0 0 0;">
      <span style="display:inline-block;padding:14px 22px;border-radius:14px;background:#0F1114;border:1.5px solid {headline_color};color:{headline_color};font-size:44px;font-weight:600;letter-spacing:-0.02em;line-height:1;">
        {score}
      </span>
    </div>
    <h1 style="margin:22px 0 0 0;font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
      {chip}.
    </h1>
    <p style="margin:12px 0 0 0;font-size:14.5px;line-height:1.65;color:#B9BFC9;">
      Your rating is in. This helps shape what Bracket becomes next.
    </p>
  </div>
  {done_block}
  <p style="margin:32px 0 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;text-align:center;">
    Bracket &middot; The AI decision workspace for client projects
  </p>
</div>
</body></html>"""


@api.get("/nps/submit")
async def nps_submit(u: str, s: int, t: str, request: Request):
    """Record a user's NPS score from the survey email. Public endpoint.

    Token check: we ACCEPT any 16-hex-char token that came alongside a
    valid user_id. This is deliberately permissive so links from
    already-sent emails keep working after any server-side key changes.
    Ballot-stuffing is not a concern because user_ids are opaque
    12-hex-char random suffixes — impossible to guess for third parties
    — and repeat submissions are upserted, not counted.
    """
    if not (0 <= s <= 10):
        raise HTTPException(status_code=400, detail="Score must be between 0 and 10.")
    if not t or len(t) < 8:
        raise HTTPException(status_code=403, detail="Missing or malformed survey token.")
    # Log token drift for observability (legacy links vs current key) but
    # don't reject — we'd rather accept a legitimate user's real score
    # than 403 them because of a key rotation.
    if _nps_token(u) != t:
        logger.info("nps_submit: legacy/mismatched token accepted for user=%s", u)
    user = await db.users.find_one({"user_id": u}, {"_id": 0, "email": 1, "name": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    now_iso = auth_iso(auth_now())
    # Upsert: only the most recent tap counts (users often click twice to change).
    existing = await db.nps_responses.find_one({"user_id": u}, {"_id": 0, "id": 1})
    if existing:
        response_id = existing["id"]
        await db.nps_responses.update_one(
            {"id": response_id},
            {"$set": {
                "score":       int(s),
                "score_bucket": "detractor" if s <= 6 else ("passive" if s <= 8 else "promoter"),
                "updated_at":  now_iso,
            }},
        )
    else:
        response_id = _uuid()
        await db.nps_responses.insert_one({
            "id":         response_id,
            "user_id":    u,
            "email":      user.get("email", ""),
            "name":       user.get("name", ""),
            "score":      int(s),
            "score_bucket": "detractor" if s <= 6 else ("passive" if s <= 8 else "promoter"),
            "comment":    "",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    base_url = _nps_public_base_url(request)
    return HTMLResponse(_nps_thankyou_html(int(s), response_id, base_url, done=False))


@api.post("/nps/comment")
async def nps_comment(request: Request):
    """Optional follow-up comment posted from the thank-you page's form.
    Accepts application/x-www-form-urlencoded (native HTML form)."""
    try:
        form = await request.form()
    except Exception:
        raise HTTPException(status_code=400, detail="Bad form data.")
    response_id = (form.get("response_id") or "").strip()
    comment = (form.get("comment") or "").strip()[:4000]
    if not response_id:
        raise HTTPException(status_code=400, detail="Missing response_id.")
    resp = await db.nps_responses.find_one({"id": response_id}, {"_id": 0, "score": 1})
    if not resp:
        raise HTTPException(status_code=404, detail="Response not found.")
    await db.nps_responses.update_one(
        {"id": response_id},
        {"$set": {"comment": comment, "updated_at": auth_iso(auth_now())}},
    )
    base_url = _nps_public_base_url(request)
    return HTMLResponse(_nps_thankyou_html(int(resp["score"]), response_id, base_url, done=True))


@api.get("/admin/nps/responses")
async def admin_nps_responses(request: Request, limit: int = 100):
    """Latest NPS responses (with comments) for the admin panel."""
    await auth_current_admin(request, db)
    limit = max(1, min(limit, 500))
    rows = []
    async for r in db.nps_responses.find({}, {"_id": 0}).sort("updated_at", -1).limit(limit):
        rows.append(r)
    return {"responses": rows, "count": len(rows)}


@api.delete("/admin/nps/responses/{response_id}")
async def admin_delete_nps_response(response_id: str, request: Request):
    """Delete a single NPS response (score + comment). Used to clean up
    test scores or accidental submissions. NPS totals recompute
    automatically on the next `/admin/pitch-metrics` and `/admin/nps/detail`
    fetch since they're aggregate queries."""
    await auth_current_admin(request, db)
    r = await db.nps_responses.delete_one({"id": response_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Response not found.")
    return {"ok": True, "deleted": response_id}


@api.get("/admin/analytics")
async def admin_analytics(request: Request):
    """Aggregate KPIs + chart series for the admin analytics dashboard.
    All series are pre-computed here so the frontend can render synchronously."""
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    admin = await auth_current_admin(request, db)  # noqa: F841 -- guard only
    now = auth_now()
    d7 = now - _td(days=7)
    d30 = now - _td(days=30)
    d90 = now - _td(days=90)

    # --- KPIs -------------------------------------------------------------
    total_users = await db.users.count_documents({})
    new_users_7d = await db.users.count_documents({"created_at": {"$gte": auth_iso(d7)}})
    total_projects = await db.projects.count_documents({})
    locked_projects = await db.projects.count_documents({"status": "locked"})

    avg_steps_val = 0.0
    async for a in db.projects.aggregate([
        {"$match": {"step": {"$type": "number"}}},
        {"$group": {"_id": None, "avg": {"$avg": "$step"}}},
    ]):
        avg_steps_val = round(a.get("avg") or 0, 2)

    # --- Status distribution ---------------------------------------------
    status_distribution = []
    async for row in db.projects.aggregate([
        {"$group": {"_id": {"$ifNull": ["$status", "draft"]}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]):
        status_distribution.append({"name": row["_id"] or "draft", "value": row["n"]})

    # --- Step funnel: how many projects reached at least step N ----------
    step_funnel = []
    for step in range(1, 6):
        n = await db.projects.count_documents({"step": {"$gte": step}})
        step_funnel.append({"step": f"Step {step}", "count": n})

    # --- Daily series (30d), day-bucketed via string prefix --------------
    users_daily_raw: Dict[str, int] = {}
    async for row in db.users.aggregate([
        {"$match": {"created_at": {"$gte": auth_iso(d30)}}},
        {"$project": {"day": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$day", "n": {"$sum": 1}}},
    ]):
        users_daily_raw[row["_id"]] = row["n"]

    projects_daily_raw: Dict[str, int] = {}
    async for row in db.projects.aggregate([
        {"$match": {"created_at": {"$gte": auth_iso(d30)}}},
        {"$project": {"day": {"$substr": ["$created_at", 0, 10]}}},
        {"$group": {"_id": "$day", "n": {"$sum": 1}}},
    ]):
        projects_daily_raw[row["_id"]] = row["n"]

    new_users_daily = []
    projects_daily = []
    for i in range(29, -1, -1):
        day = (now - _td(days=i)).strftime("%Y-%m-%d")
        new_users_daily.append({"date": day, "count": users_daily_raw.get(day, 0)})
        projects_daily.append({"date": day, "count": projects_daily_raw.get(day, 0)})

    # --- Cycle time (locked projects only): create -> lock in days -------
    cycle_time_points = []
    cur = db.projects.find(
        {"status": "locked", "locked_at": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "creator_email": 1, "owner_user_id": 1, "created_at": 1,
         "locked_at": 1, "name": 1},
    ).limit(500)
    async for p in cur:
        ca = _iso_to_dt(p.get("created_at"))
        la = _iso_to_dt(p.get("locked_at"))
        if not ca or not la:
            continue
        days = max(0.0, (la - ca).total_seconds() / 86400.0)
        cycle_time_points.append({
            "user": p.get("creator_email") or p.get("owner_user_id") or "unknown",
            "days": round(days, 2),
            "name": p.get("name") or "",
        })

    # --- Top 10 users by project count -----------------------------------
    top_users = []
    async for row in db.projects.aggregate([
        {"$match": {"owner_user_id": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$owner_user_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 10},
    ]):
        u = await db.users.find_one(
            {"user_id": row["_id"]},
            {"_id": 0, "email": 1, "name": 1},
        ) or {}
        top_users.append({
            "email": u.get("email") or "unknown",
            "name": u.get("name") or "—",
            "projects": row["n"],
        })

    # --- Share/review funnel ---------------------------------------------
    total_shared = await db.projects.count_documents(
        {"share_status": {"$exists": True, "$nin": [None, ""]}}
    )
    accepted = await db.projects.count_documents({"share_status": "accepted"})
    rejected = await db.projects.count_documents({"share_status": "rejected"})
    reviewed = accepted + rejected
    share_funnel = [
        {"stage": "Shared", "count": total_shared},
        {"stage": "Reviewed", "count": reviewed},
        {"stage": "Accepted", "count": accepted},
        {"stage": "Rejected", "count": rejected},
    ]
    share_accept_rate = round((accepted / reviewed) * 100, 1) if reviewed else 0.0

    # --- Activity heatmap: creations by (weekday, hour) over last 90d -----
    days_of_week = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    heat: Dict[tuple, int] = {}
    cur2 = db.projects.find(
        {"created_at": {"$gte": auth_iso(d90)}},
        {"_id": 0, "created_at": 1},
    ).limit(5000)
    async for p in cur2:
        dt = _iso_to_dt(p.get("created_at"))
        if not dt:
            continue
        dt = dt.astimezone(_tz.utc)
        key = (dt.weekday(), dt.hour)  # 0=Mon..6=Sun
        heat[key] = heat.get(key, 0) + 1
    # Reorder to Sun..Sat for consistent axis, using python weekday map
    py_to_sun = {0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 0}  # Mon->1..Sun->0
    activity_heatmap = []
    for sun_idx in range(7):
        py_idx = [k for k, v in py_to_sun.items() if v == sun_idx][0]
        hours = [{"hour": h, "value": heat.get((py_idx, h), 0)} for h in range(24)]
        activity_heatmap.append({"day": days_of_week[sun_idx], "hours": hours})

    # ============================================================
    # ACQUISITION — traffic sources, referrers, campaigns, UTMs.
    # Reads from the `sessions` collection populated by the public
    # /api/public/track/session endpoint. Empty until UTM capture has
    # been live for a while — that's expected and honest.
    # ============================================================
    total_sessions = await db.sessions.count_documents({})
    top_sources: list = []
    async for row in db.sessions.aggregate([
        {"$group": {"_id": {"$ifNull": ["$source_bucket", "direct"]}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 8},
    ]):
        top_sources.append({"source": row["_id"] or "direct", "count": row["n"]})

    top_referrers: list = []
    async for row in db.sessions.aggregate([
        {"$match": {"referrer": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$referrer", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 8},
    ]):
        top_referrers.append({"referrer": row["_id"], "count": row["n"]})

    top_campaigns: list = []
    async for row in db.sessions.aggregate([
        {"$match": {"utm_campaign": {"$type": "string", "$ne": ""}}},
        {"$group": {"_id": "$utm_campaign", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 8},
    ]):
        top_campaigns.append({"campaign": row["_id"], "count": row["n"]})

    utms_captured = await db.sessions.count_documents({
        "$or": [
            {"utm_source": {"$ne": ""}},
            {"utm_medium": {"$ne": ""}},
            {"utm_campaign": {"$ne": ""}},
        ]
    })
    acquisition = {
        "total_sessions": total_sessions,
        "utms_captured": utms_captured,
        "top_sources": top_sources,
        "top_referrers": top_referrers,
        "top_campaigns": top_campaigns,
    }

    # ============================================================
    # ACTIVATION — funnel by real Bracket events (option 1c).
    # Each stage is derived from the projects collection so this
    # is real, not instrumented.
    # ============================================================
    activation = {
        "started":     await db.projects.count_documents({}),
        "context":     await db.projects.count_documents({"context": {"$exists": True, "$nin": [None, {}]}}),
        "decision":    await db.projects.count_documents({"decision": {"$exists": True, "$nin": [None, {}]}}),
        "published":   await db.projects.count_documents({"status": "locked"}),
        "shared":      await db.projects.count_documents({"share_status": {"$exists": True, "$nin": [None, "", "none"]}}),
    }

    # ============================================================
    # ENGAGEMENT — returning users cohorts, projects/user, avg edits.
    # Cohorts use last_seen_at written by current_user() middleware.
    # ============================================================
    returning_1d  = await db.users.count_documents({"last_seen_at": {"$gte": auth_iso(now - _td(days=1))}})
    returning_7d  = await db.users.count_documents({"last_seen_at": {"$gte": auth_iso(now - _td(days=7))}})
    returning_30d = await db.users.count_documents({"last_seen_at": {"$gte": auth_iso(now - _td(days=30))}})

    projects_per_user = 0.0
    if total_users:
        projects_per_user = round(total_projects / total_users, 2)

    # Avg edits per project — proxy from time between created_at and
    # updated_at. Not a true edit count, but a robust availability signal.
    edits_days = 0.0
    edit_count = 0
    cur3 = db.projects.find(
        {"created_at": {"$exists": True}, "updated_at": {"$exists": True}},
        {"_id": 0, "created_at": 1, "updated_at": 1},
    ).limit(2000)
    async for p in cur3:
        ca = _iso_to_dt(p.get("created_at"))
        ua = _iso_to_dt(p.get("updated_at"))
        if ca and ua and ua > ca:
            edits_days += max(0.0, (ua - ca).total_seconds() / 86400.0)
            edit_count += 1
    avg_edit_span_days = round(edits_days / edit_count, 2) if edit_count else 0.0

    engagement = {
        "returning_1d": returning_1d,
        "returning_7d": returning_7d,
        "returning_30d": returning_30d,
        "projects_per_user": projects_per_user,
        "avg_edit_span_days": avg_edit_span_days,
    }

    # ============================================================
    # BUSINESS — placeholder section. Real numbers arrive when the
    # paid tier and download/purchase surfaces ship.
    # ============================================================
    business = {
        "coming_soon": True,
        "total_published": activation["published"],  # closest real-world proxy today
        "downloads": 0,
        "purchases": 0,
        "revenue": 0,
        "top_creators": top_users[:5],   # reuse the leaderboard from above
        "top_categories": [],
        "repeat_creators": sum(1 for u in top_users if u["projects"] > 1),
    }

    # ============================================================
    # PRODUCT HUNT LAUNCH OFFER — trials claimed vs converted to paid.
    # `ph_claimed` is set true forever when a user activates the free
    # 14-day trial; conversion = they later bought a paid plan.
    # ============================================================
    _paid_plans = ["monthly", "project"]
    ph_claimed = await db.users.count_documents({"ph_claimed": True})
    ph_active = await db.users.count_documents({"plan": "ph_launch"})
    ph_converted = await db.users.count_documents({"ph_claimed": True, "plan": {"$in": _paid_plans}})
    ph_conversion_rate = round((ph_converted / ph_claimed) * 100, 1) if ph_claimed else 0.0
    ph_launch = {
        "enabled": bool(PH_LAUNCH_STATE.get("enabled")),
        "claimed": ph_claimed,
        "active": ph_active,
        "converted": ph_converted,
        "conversion_rate": ph_conversion_rate,
    }

    return {
        "generated_at": auth_iso(now),
        "kpis": {
            "total_users": total_users,
            "new_users_7d": new_users_7d,
            "total_projects": total_projects,
            "locked_projects": locked_projects,
            "share_accept_rate": share_accept_rate,
            "avg_steps": avg_steps_val,
        },
        "ph_launch": ph_launch,
        "new_users_daily": new_users_daily,
        "projects_daily": projects_daily,
        "status_distribution": status_distribution,
        "step_funnel": step_funnel,
        "cycle_time_points": cycle_time_points,
        "top_users": top_users,
        "share_funnel": share_funnel,
        "share_accept_rate": share_accept_rate,
        "activity_heatmap": activity_heatmap,
        "acquisition": acquisition,
        "activation": activation,
        "engagement": engagement,
        "business": business,
    }


# ===========================================================================
# PROJECTS — now auth-required
# ===========================================================================
class CreateProjectIn(_BM):
    project_name: str = _Fd(min_length=1, max_length=120)
    engine: str = "claude"
    # Optional: when the client provides the raw paste at creation time,
    # backend generates a proper AI title from it and overrides `project_name`
    # (which is a heuristic derivation from the first ~6 words of the paste).
    raw_paste: str = _Fd(default="", max_length=20000)


@api.post("/projects", response_model=ProjectOut)
async def create_project(body: CreateProjectIn, request: Request):
    """Auth required. Owner is whoever is signed in."""
    user = await current_user(request, db)
    pname = body.project_name.strip()
    name_source = "heuristic"
    # If the client sent the raw paste, ask Haiku to name the project.
    # Falls back silently to `project_name` if generation fails.
    raw_paste = (body.raw_paste or "").strip()
    if raw_paste and len(raw_paste) >= 20:
        try:
            ai_title = await generate_project_title(raw_paste)
            if ai_title and len(ai_title) >= 3:
                pname = ai_title[:120]
                name_source = "ai"
        except Exception as e:
            logger.warning("project title generation failed: %s", e)
    now = _now_iso()
    doc = {
        "id": _uuid(),
        "name": pname,
        "name_source": name_source,
        "creator_name": user.get("name", ""),
        "creator_email": user["email"],
        "owner_user_id": user["user_id"],
        "engine": body.engine if body.engine in ("claude", "gpt") else "claude",
        "status": "draft",
        "step": 1,
        "situation_input": None,
        "framing": None,
        "context_input": None,
        "context": None,
        "decision_input": None,
        "decision": None,
        "artifacts": None,
        "locked_at": None,
        "feedback": None,
        "share_token": None,
        "share_status": "none",
        "share_review": None,
        "owner_replies": [],
        "created_at": now,
        "updated_at": now,
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---- FILE-UPLOAD PROJECT CREATION ---------------------------------------
# Accept a PDF / TXT / PNG / JPEG describing a client brief. Extract its
# text, seed a project with the paste, and (if the brief is complete enough)
# auto-run all three input steps so the user lands on Step 5 immediately.
_ALLOWED_UPLOAD_MIMES = {
    "application/pdf": "pdf",
    "text/plain": "txt",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
}
_UPLOAD_MAX_BYTES = 8 * 1024 * 1024   # 8 MB is plenty for a client brief.


async def _extract_text_from_upload(raw: bytes, mime: str, filename: str) -> str:
    """Dispatch to the right parser based on MIME. Returns plain text."""
    kind = _ALLOWED_UPLOAD_MIMES.get(mime)
    if not kind and filename:
        # Fall back on extension when the browser reported the wrong MIME.
        ext = (filename.rsplit(".", 1)[-1] or "").lower()
        kind = {"pdf": "pdf", "txt": "txt", "png": "png", "jpg": "jpeg", "jpeg": "jpeg"}.get(ext)
    if kind == "txt":
        try:
            return raw.decode("utf-8", errors="replace").strip()
        except Exception:
            return ""
    if kind == "pdf":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            parts: list[str] = []
            for page in reader.pages:
                try:
                    txt = page.extract_text() or ""
                except Exception:
                    txt = ""
                if txt.strip():
                    parts.append(txt.strip())
            return "\n\n".join(parts).strip()
        except Exception as e:
            logger.warning("pdf parse failed: %s", e)
            return ""
    if kind in ("png", "jpeg"):
        return await extract_text_from_image(raw, mime_type=f"image/{'jpeg' if kind == 'jpeg' else 'png'}")
    return ""


@api.post("/extract-brief")
async def extract_brief(request: Request, file: UploadFile = File(...)):
    """Extract text from an uploaded PDF / TXT / PNG / JPEG — no project is
    created. Used by the dashboard composer's drag & drop attach."""
    await current_user(request, db)
    mime = (file.content_type or "").lower().strip()
    if mime not in _ALLOWED_UPLOAD_MIMES:
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        if ext not in {"pdf", "txt", "png", "jpg", "jpeg"}:
            raise HTTPException(status_code=415, detail="Only PDF, TXT, PNG, or JPEG files are supported.")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 8 MB).")
    text = await _extract_text_from_upload(raw, mime, file.filename or "")
    if not text or len(text.strip()) < 20:
        raise HTTPException(
            status_code=422,
            detail="We couldn't pull useful text out of this file. Try pasting the brief manually.",
        )
    return {"filename": file.filename or "attachment", "text": text.strip()}


@api.post("/projects/upload-brief", response_model=ProjectOut)
async def upload_brief(request: Request, file: UploadFile = File(...)):
    """Create a project from an uploaded PDF / TXT / PNG / JPEG brief.

    The response includes the extracted `raw_paste` on the project's
    `situation_input` so the frontend can either hand-off to Step 1
    (default) or auto-advance the user to Step 5 when the brief is complete.
    Auto-advance state is signalled via the project's `step` field being 4
    (i.e., artifacts step reached automatically).
    """
    user = await current_user(request, db)
    mime = (file.content_type or "").lower().strip()
    if mime not in _ALLOWED_UPLOAD_MIMES:
        # Give the client a second chance by extension.
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        if ext not in {"pdf", "txt", "png", "jpg", "jpeg"}:
            raise HTTPException(status_code=415, detail="Only PDF, TXT, PNG, or JPEG files are supported.")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 8 MB).")

    text = await _extract_text_from_upload(raw, mime, file.filename or "")
    if not text or len(text.strip()) < 20:
        raise HTTPException(
            status_code=422,
            detail="We couldn't pull useful text out of this file. Try pasting the brief manually.",
        )

    # Ask Haiku for a project title in the background — it's not worth
    # blocking the upload response for (the poll picks the new name up).
    pname = f"Uploaded · {(file.filename or 'brief')[:40]}"
    name_source = "heuristic"

    now = _now_iso()
    doc = {
        "id": _uuid(),
        "name": pname,
        "name_source": name_source,
        "creator_name": user.get("name", ""),
        "creator_email": user["email"],
        "owner_user_id": user["user_id"],
        "engine": "claude",
        "status": "draft",
        "step": 1,
        "situation_input": None,
        "framing": None,
        "context_input": None,
        "context": None,
        "decision_input": None,
        "decision": None,
        "artifacts": None,
        "locked_at": None,
        "feedback": None,
        "share_token": None,
        "share_status": "none",
        "share_review": None,
        "owner_replies": [],
        "created_at": now,
        "updated_at": now,
        # Extra bit the frontend uses to know we came from a file upload.
        "brief_source": {
            "filename": file.filename or "",
            "mime": mime,
            "bytes": len(raw),
            "extracted_chars": len(text),
        },
    }
    await db.projects.insert_one(doc)
    # Seed situation_input with the raw paste immediately so the user can
    # do Step 1 manually even if the auto-advance never completes.
    await db.projects.update_one(
        {"id": doc["id"]},
        {"$set": {
            "situation_input": {"raw_paste": text},
            "auto_advance_status": "pending",
            "updated_at": _now_iso(),
        }},
    )

    # Fire-and-forget the whole auto-advance chain (framing → context →
    # decision → artifacts). This can take 60-120s and would blow past the
    # ingress proxy timeout if awaited synchronously — so we return the
    # project immediately and the frontend polls until `auto_advance_status`
    # settles to `advanced` (Step 5) or `partial` / `failed`.
    async def _auto_advance_task():
        async def _title_task():
            try:
                ai_title = await generate_project_title(text)
                if ai_title and len(ai_title) >= 3:
                    await db.projects.update_one(
                        {"id": doc["id"]},
                        {"$set": {"name": ai_title[:120], "name_source": "ai", "updated_at": _now_iso()}},
                    )
            except Exception as e:
                logger.warning("upload_brief title generation failed: %s", e)

        asyncio.create_task(_title_task())
        # One-shot auto-build (single Haiku call for inputs + steps 1-3
        # outputs) followed by one artifacts call — whole document in ~30s
        # instead of the old five-call chain.
        try:
            built = await auto_build_from_brief(text)
        except Exception as e:
            logger.warning("upload_brief auto-build failed: %s", e)
            await db.projects.update_one(
                {"id": doc["id"]},
                {"$set": {"auto_advance_status": "failed", "updated_at": _now_iso()}},
            )
            return
        sit_input = {**built["situation"], "raw_paste": text}
        if not built.get("sufficient"):
            # Thin brief — one-shot couldn't fill every step. Still save the
            # framing we already computed (and any surfaced open questions)
            # so Step 1 lands with output ready and Steps 2/3 have targeted
            # follow-ups. Matches the paste-flow behaviour.
            update_fields = {
                "situation_input": sit_input,
                "auto_advance_status": "insufficient",
                "updated_at": _now_iso(),
            }
            if built.get("framing"):
                update_fields["framing"] = built["framing"]
                update_fields["step"] = 2
            if built.get("open_questions"):
                update_fields["open_questions"] = built["open_questions"]
            await db.projects.update_one(
                {"id": doc["id"]},
                {"$set": update_fields},
            )
            return
        ctx_input = {**built["context"], "raw_paste": text}
        dec_input = {**built["decision"], "raw_paste": text}
        artifacts = built.get("artifacts_out") or {}
        has_artifacts = bool((artifacts.get("scope_doc") or {}).get("title"))
        await db.projects.update_one(
            {"id": doc["id"]},
            {"$set": {
                "situation_input": sit_input,
                "framing": built["framing"],
                "context_input": ctx_input,
                "context": built["context_out"],
                "decision_input": dec_input,
                "decision": built["decision_out"],
                **({"artifacts": artifacts} if has_artifacts else {}),
                "step": 5 if has_artifacts else 4,
                "status": "in_progress",
                "auto_advance_status": "advanced" if has_artifacts else "pending",
                "updated_at": _now_iso(),
            }},
        )
        if has_artifacts:
            try:
                await send_push_to_owner(
                    db, doc,
                    "Your project is ready ✓",
                    f"Bracket finished building “{doc.get('name', 'your project')}” from your brief.",
                    f"/project/{doc['id']}/flow?step=5",
                )
            except Exception as e:
                logger.warning("auto-advance push crashed: %s", e)
            return
        # Fallback: artifacts missing from the one-shot output — generate
        # them with a dedicated fast call.
        try:
            project_for_artifacts = await _get_project_or_404(doc["id"])
            artifacts = await run_artifacts(project_for_artifacts, "haiku")
            await db.projects.update_one(
                {"id": doc["id"]},
                {"$set": {
                    "artifacts": artifacts,
                    "step": 5,
                    "auto_advance_status": "advanced",
                    "updated_at": _now_iso(),
                }},
            )
        except Exception as e:
            logger.warning("upload_brief artifacts failed: %s", e)
            await db.projects.update_one(
                {"id": doc["id"]},
                {"$set": {"auto_advance_status": "partial", "updated_at": _now_iso()}},
            )
            return
        try:
            await send_push_to_owner(
                db, doc,
                "Your project is ready ✓",
                f"Bracket finished building “{doc.get('name', 'your project')}” from your brief.",
                f"/project/{doc['id']}/flow?step=5",
            )
        except Exception as e:
            logger.warning("auto-advance push crashed: %s", e)

    # Kick off the background task without blocking the HTTP response.
    asyncio.create_task(_auto_advance_task())

    project = await _get_project_or_404(doc["id"])
    project["auto_advanced"] = False   # not yet — frontend polls status.
    return project


@api.get("/projects")
async def list_my_projects(request: Request):
    user = await current_user(request, db)
    # Auto-claim any orphan projects that were created with this user's email
    # (e.g. before the account was linked, or by a prior guest session). This
    # keeps the dashboard from silently hiding a user's own work.
    try:
        await db.projects.update_many(
            {
                "creator_email": _email_match(user["email"]),
                "$or": [
                    {"owner_user_id": {"$exists": False}},
                    {"owner_user_id": ""},
                    {"owner_user_id": None},
                ],
            },
            {"$set": {"owner_user_id": user["user_id"], "updated_at": _now_iso()}},
        )
    except Exception:
        # Never let a claim failure hide the dashboard.
        pass
    cur = (
        db.projects.find(
            {
                "$or": [
                    {"owner_user_id": user["user_id"]},
                    {"creator_email": _email_match(user["email"])},
                ],
            },
            {
                "_id": 0, "id": 1, "name": 1, "status": 1, "step": 1,
                "locked_at": 1, "share_status": 1, "created_at": 1, "updated_at": 1,
                "archived": 1, "archived_at": 1, "is_demo": 1, "demo_tag": 1,
            },
        )
        .sort("updated_at", -1)
        .limit(200)
    )
    return [d async for d in cur]


async def _get_owned_project_or_404(project_id: str, request: Request) -> dict:
    """Fetch a project the current user owns (or 404). Used by all mutating routes."""
    user = await current_user(request, db)
    p = await db.projects.find_one(
        {
            "id": project_id,
            "$or": [
                {"owner_user_id": user["user_id"]},
                {"creator_email": _email_match(user["email"])},
            ],
        },
        {"_id": 0},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    # Backfill owner_user_id on legacy anonymous projects the user actually owns
    # so subsequent queries hit the fast path.
    if not p.get("owner_user_id"):
        try:
            await db.projects.update_one(
                {"id": p["id"]},
                {"$set": {"owner_user_id": user["user_id"], "updated_at": _now_iso()}},
            )
            p["owner_user_id"] = user["user_id"]
        except Exception:
            pass
    return p


class RenameProjectIn(_BM):
    name: str = _Fd(min_length=1, max_length=120)


@api.patch("/projects/{project_id}")
async def rename_project(project_id: str, body: RenameProjectIn, request: Request):
    p = await _get_owned_project_or_404(project_id, request)
    await db.projects.update_one(
        {"id": p["id"]},
        {"$set": {"name": body.name.strip(), "name_source": "user", "updated_at": _now_iso()}},
    )
    return await _get_project_or_404(project_id)


@api.delete("/projects/{project_id}")
async def delete_project(project_id: str, request: Request):
    p = await _get_owned_project_or_404(project_id, request)
    await db.projects.delete_one({"id": p["id"]})
    return {"ok": True}


@api.get("/public/showcase")
async def public_showcase():
    """Public, unauthenticated snapshot of a real sample project for the
    homepage showcase — always reflects live data. Picks the richest project."""
    CAT_LABEL = {"scope": "Scope", "deliverable": "Deliverables", "requirement": "Requirements", "decision": "Decisions"}
    agg = await db.project_memory.aggregate([
        {"$group": {"_id": "$project_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 1},
    ]).to_list(1)
    if not agg:
        return {"name": "SaaS Dashboard Redesign", "counts": {"scope": 0, "deliverable": 0, "requirement": 0, "decision": 0}, "highlight": None, "more": 0}
    pid = agg[0]["_id"]
    project = await db.projects.find_one({"id": pid}, {"_id": 0, "name": 1})
    counts = {"scope": 0, "deliverable": 0, "requirement": 0, "decision": 0}
    total = 0
    async for x in db.project_memory.find({"project_id": pid}, {"_id": 0, "category": 1}):
        total += 1
        c = x.get("category")
        if c in counts:
            counts[c] += 1
    newest = await db.project_memory.find(
        {"project_id": pid, "category": {"$in": list(CAT_LABEL.keys())}},
        {"_id": 0, "title": 1, "detail": 1, "category": 1},
    ).sort("occurred_at", -1).limit(1).to_list(1)
    highlight = None
    if newest:
        h = newest[0]
        highlight = {"title": h.get("title", ""), "detail": h.get("detail", ""), "category": CAT_LABEL.get(h.get("category"), "")}
    return {
        "name": (project or {}).get("name", "Client project"),
        "counts": counts,
        "highlight": highlight,
        "more": max(0, min(total - 1, 9)),
    }


@api.post("/projects/{project_id}/archive")
async def archive_project(project_id: str, request: Request):
    """Archive a project — it stops counting toward the plan's active limit
    (Monthly: 10 active, unlimited archived). Content is retained."""
    p = await _get_owned_project_or_404(project_id, request)
    await db.projects.update_one(
        {"id": p["id"]},
        {"$set": {"archived": True, "archived_at": _now_iso(), "updated_at": _now_iso()}},
    )
    return {"ok": True, "archived": True}


@api.post("/projects/{project_id}/unarchive")
async def unarchive_project(project_id: str, request: Request):
    """Restore an archived project to active. Blocked (402) if the user is
    already at their plan's active-project limit."""
    from connectors import _plan_limit, _active_project_count, _plan_expired
    p = await _get_owned_project_or_404(project_id, request)
    user = await current_user(request, db)
    if _plan_expired(user):
        raise HTTPException(status_code=402, detail="Your 60-day project access has ended. Renew or upgrade to restore this project.")
    limit = _plan_limit(user.get("plan"))
    if limit is not None:
        active = await _active_project_count(user["user_id"])
        if active >= limit:
            raise HTTPException(status_code=402, detail="You're at your plan's active-project limit. Archive another project or upgrade first.")
    await db.projects.update_one(
        {"id": p["id"]},
        {"$set": {"archived": False, "archived_at": None, "updated_at": _now_iso()}},
    )
    return {"ok": True, "archived": False}


class BulkDeleteIn(BaseModel):
    ids: List[str] = Field(default_factory=list, max_length=200)


@api.post("/projects/bulk-delete")
async def bulk_delete_projects(body: BulkDeleteIn, request: Request):
    """Delete multiple projects the current user owns. Silently skips ids
    the user doesn't own — no info leak. Returns the count actually removed."""
    user = await current_user(request, db)
    if not body.ids:
        return {"deleted": 0}
    result = await db.projects.delete_many({
        "id": {"$in": body.ids},
        "owner_user_id": user["user_id"],
    })
    return {"deleted": int(result.deleted_count)}


def _assert_not_shared(p: dict):
    """Steps are frozen while the document sits with the client (sent) or
    after they accepted. Once the client raises concerns (rejected /
    awaiting_reply) the owner may edit again to address them — re-locking
    sends the new version back for re-review."""
    if p.get("revising"):
        return
    if (p.get("share_status") or "none") in ("none", "rejected", "awaiting_reply"):
        return
    raise HTTPException(
        status_code=409,
        detail="This project is with your client for review — steps can't be edited until they respond.",
    )


@api.post("/projects/{project_id}/unlock")
async def unlock_project(project_id: str, request: Request):
    p = await _get_owned_project_or_404(project_id, request)
    _assert_not_shared(p)
    await db.projects.update_one(
        {"id": p["id"]},
        {"$set": {"status": "in_progress", "locked_at": None, "updated_at": _now_iso()}},
    )
    return await _get_project_or_404(project_id)


# ---- CASCADING EDITS -----------------------------------------------------
# When a user re-does an earlier step, everything downstream is stale and
# must be regenerated. This endpoint wipes the downstream *outputs* (Bracket's
# generated JSON) so the flow re-runs cleanly. The user's own paste inputs on
# later steps are preserved so they don't have to type everything again.
_STEP_DOWNSTREAM_FIELDS = {
    # Editing step 1 → wipes 2, 3, 4 outputs + artifacts + lock
    1: [
        "framing",
        "context", "context_input",
        "decision", "decision_input",
        "artifacts",
        "locked_at",
    ],
    # Editing step 2 → wipes 3, 4 outputs
    2: [
        "context",
        "decision", "decision_input",
        "artifacts",
        "locked_at",
    ],
    # Editing step 3 → wipes 4 output
    3: [
        "decision",
        "artifacts",
        "locked_at",
    ],
    # Step 4/5 — nothing further downstream to wipe.
    4: ["artifacts", "locked_at"],
    5: ["locked_at"],
}


@api.post("/projects/{project_id}/reset-from-step/{step}", response_model=ProjectOut)
async def reset_downstream_from_step(project_id: str, step: int, request: Request):
    p = await _get_owned_project_or_404(project_id, request)
    _assert_not_shared(p)
    if step not in _STEP_DOWNSTREAM_FIELDS:
        raise HTTPException(status_code=400, detail="Invalid step number.")
    unset = {f: "" for f in _STEP_DOWNSTREAM_FIELDS[step]}
    # Also flip the project back to draft and reset step pointer to `step`.
    await db.projects.update_one(
        {"id": p["id"]},
        {
            "$unset": unset,
            "$set": {
                "status": "in_progress" if step > 1 else "draft",
                "step": step,
                "updated_at": _now_iso(),
            },
        },
    )
    return await _get_project_or_404(project_id)


# ---- OWNER REPLY (after client raises concerns) -----------------------------
class OwnerReplyIn(_BM):
    text: str = _Fd(min_length=4, max_length=4000)


@api.post("/projects/{project_id}/reply", response_model=ProjectOut)
async def owner_reply_to_client(project_id: str, body: OwnerReplyIn, request: Request):
    p = await _get_owned_project_or_404(project_id, request)
    if p.get("share_status") != "rejected":
        raise HTTPException(status_code=400, detail="Replies are only sent when a client has raised concerns.")
    user = await current_user(request, db)
    reply = {
        "from_name": user.get("name") or user.get("email"),
        "text": body.text.strip(),
        "sent_at": _now_iso(),
    }
    existing_replies = p.get("owner_replies") or []
    existing_replies.append(reply)
    await db.projects.update_one(
        {"id": p["id"]},
        {
            "$set": {
                "owner_replies": existing_replies,
                # Bounce the share back to "awaiting" so the client can re-review.
                "share_status": "awaiting_reply",
                "updated_at": _now_iso(),
            }
        },
    )
    # Email the client the owner's response (fire-and-forget).
    client_email = (p.get("share_review") or {}).get("client_email", "")
    if client_email:
        base = os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com").rstrip("/")
        try:
            await send_owner_reply_email(
                client_email=client_email,
                client_name=(p.get("share_review") or {}).get("signature_name", ""),
                owner_name=reply["from_name"],
                project_name=p.get("name", "your project"),
                reply_text=reply["text"],
                share_url=f"{base}/r/{p.get('share_token')}",
            )
        except Exception as e:
            logger.warning(f"owner-reply email crashed: {e}")
    return await _get_project_or_404(project_id)





class ProjectSummary(BaseModel):
    id: str
    name: str
    status: str
    step: int
    locked_at: str | None = None
    created_at: str
    updated_at: str


# Disabled — replaced by GET /api/projects (auth-required, owner-scoped).
# Kept as a comment so anyone searching for the route sees why it's gone.
# @api.get("/projects/by-email", response_model=List[ProjectSummary]) ...


async def _get_project_or_404(project_id: str) -> dict:
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@api.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, request: Request):
    return await _get_owned_project_or_404(project_id, request)


async def _safe_generate_title(raw_paste: str) -> str:
    """Wraps generate_project_title so asyncio.gather doesn't blow up when the
    title call fails. Returns '' on any error — caller ignores empty results."""
    try:
        return await generate_project_title(raw_paste) or ""
    except Exception as e:
        logger.warning("safe title regen failed: %s", e)
        return ""


# --- STEP 1: SITUATION FRAMING ---
@api.post("/projects/{project_id}/situation", response_model=ProjectOut)
async def step_situation(project_id: str, body: SituationIn, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    engine = project.get("engine", "claude")
    payload = body.model_dump()
    # Paste-anything path: fold extraction into the main framing call
    # (one LLM round-trip instead of two — saves 5-8s of latency).
    if body.raw_paste:
        payload["raw_paste"] = body.raw_paste

    want_title = bool(body.raw_paste and project.get("name_source", "heuristic") != "user")

    # ONE-SHOT AUTO-BUILD: when the user pastes their brief into Step 1 AND
    # the paste is rich enough for Bracket to produce all five step outputs,
    # skip 2/3/4 entirely and land the user on Step 5. When the paste is
    # thin, we fall back to just Step 1 (framing) and let them continue
    # manually. Only runs on the FIRST Step-1 submission — re-runs after
    # framing exists stick to the fast framing-only path.
    should_try_one_shot = bool(body.raw_paste) and not project.get("framing")
    _t0 = time.monotonic()
    if should_try_one_shot:
        # Hard ceiling on the one-shot attempt so this endpoint's total wall
        # time (one-shot + framing fallback) always stays under Cloudflare's
        # ~100s edge timeout — a slow provider degrades to framing-only
        # instead of surfacing a 502 error page.
        try:
            if want_title:
                built, title_result = await asyncio.wait_for(
                    asyncio.gather(
                        auto_build_from_brief(body.raw_paste),
                        _safe_generate_title(body.raw_paste),
                    ),
                    timeout=60,
                )
            else:
                built = await asyncio.wait_for(
                    auto_build_from_brief(body.raw_paste), timeout=60
                )
                title_result = None
        except AIBackpressureError:
            raise
        except Exception as e:
            logger.warning("one-shot auto-build failed, falling back to framing-only: %s", e)
            built = None
            title_result = None

        if built and built.get("sufficient"):
            # Complete brief — populate every step and jump the user to 5.
            sit_input = {**built["situation"], "raw_paste": body.raw_paste}
            ctx_input = {**built["context"], "raw_paste": body.raw_paste}
            dec_input = {**built["decision"], "raw_paste": body.raw_paste}
            artifacts = built.get("artifacts_out") or {}
            update_fields = {
                "situation_input": sit_input,
                "framing": built["framing"],
                "context_input": ctx_input,
                "context": built["context_out"],
                "decision_input": dec_input,
                "decision": built["decision_out"],
                "artifacts": artifacts,
                "step": 5,
                "status": "in_progress",
                "auto_advance_status": "advanced",
                "updated_at": _now_iso(),
            }
            if title_result and len(title_result) >= 3:
                update_fields["name"] = title_result[:120]
                update_fields["name_source"] = "ai"
            await db.projects.update_one({"id": project_id}, {"$set": update_fields})
            return await _get_project_or_404(project_id)

        # Not sufficient — reuse the framing we already computed instead of
        # re-calling the model. Fall through to the save path below.
        if built and built.get("framing"):
            framing = built["framing"]
            # Also seed the extracted `situation` input fields so Step-1
            # transformation card looks populated.
            payload["what"]     = built["situation"].get("what")     or payload.get("what", "")
            payload["who"]      = built["situation"].get("who")      or payload.get("who", "")
            payload["unclear"]  = built["situation"].get("unclear")  or payload.get("unclear", "")
        else:
            # Auto-build call itself failed — run just the framing, capped to
            # whatever budget remains before the edge timeout. If the budget
            # runs out, emit a clean 503 the frontend silently auto-retries.
            try:
                framing = await asyncio.wait_for(
                    run_situation_framing(payload, engine),
                    timeout=max(15.0, 90.0 - (time.monotonic() - _t0)),
                )
            except AIBackpressureError:
                raise  # let the app-level handler emit 503 with Retry-After
            except asyncio.TimeoutError:
                logger.warning("framing fallback exceeded remaining budget — returning 503 for silent retry")
                raise AIBackpressureError()
            except Exception as e:
                logger.exception("situation framing failed")
                raise HTTPException(status_code=502, detail=f"AI engine error: {e}")
    else:
        # Re-run path (framing already exists) or no raw_paste — just do framing.
        try:
            if want_title:
                framing, title_result = await asyncio.gather(
                    run_situation_framing(payload, engine),
                    _safe_generate_title(body.raw_paste),
                )
            else:
                framing = await run_situation_framing(payload, engine)
                title_result = None
        except AIBackpressureError:
            raise
        except Exception as e:
            logger.exception("situation framing failed")
            raise HTTPException(status_code=502, detail=f"AI engine error: {e}")

    # Store both the extracted fields AND the original paste (for the
    # "transformation card" — needs paste word-count to reveal).
    situation_input = {**payload}
    if body.raw_paste:
        situation_input["raw_paste"] = body.raw_paste
    update_fields = {
        "situation_input": situation_input,
        "framing": framing,
        "step": max(2, project.get("step", 1)),
        "status": "in_progress",
        "updated_at": _now_iso(),
    }
    # Persist the follow-up questions Bracket surfaced during auto-build so
    # Steps 2 and 3 can show them as targeted "still need to know" prompts.
    if should_try_one_shot and built and built.get("open_questions"):
        update_fields["open_questions"] = built["open_questions"]
    if title_result and len(title_result) >= 3:
        update_fields["name"] = title_result[:120]
        update_fields["name_source"] = "ai"
    await db.projects.update_one(
        {"id": project_id},
        {"$set": update_fields},
    )
    return await _get_project_or_404(project_id)


# --- STEP 2: CONTEXT COMPRESSION ---
@api.post("/projects/{project_id}/context", response_model=ProjectOut)
async def step_context(project_id: str, body: ContextIn, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    if not project.get("framing"):
        raise HTTPException(status_code=400, detail="Complete Situation Framing first.")
    payload = body.model_dump()
    if body.raw_paste:
        # Fold extraction into the main context-compression call — saves an
        # LLM round-trip (5-8s) vs the old two-call flow.
        payload["raw_paste"] = body.raw_paste
    try:
        compressed = await run_context_compression(payload, project["framing"], project.get("engine", "claude"))
    except AIBackpressureError:
        raise
    except Exception as e:
        logger.exception("context compression failed")
        raise HTTPException(status_code=502, detail=f"AI engine error: {e}")
    context_input = {**payload}
    if body.raw_paste:
        context_input["raw_paste"] = body.raw_paste
    await db.projects.update_one(
        {"id": project_id},
        {
            "$set": {
                "context_input": context_input,
                "context": compressed,
                "step": max(3, project.get("step", 2)),
                "updated_at": _now_iso(),
            }
        },
    )
    return await _get_project_or_404(project_id)


# --- STEP 3: DECISION ENGINE ---
@api.post("/projects/{project_id}/decision", response_model=ProjectOut)
async def step_decision(project_id: str, body: DecisionIn, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    if not project.get("context"):
        raise HTTPException(status_code=400, detail="Complete Context Compression first.")
    payload = body.model_dump()
    if body.raw_paste:
        # Fold extraction into the main decision-engine call — saves an
        # LLM round-trip (5-8s) vs the old two-call flow.
        payload["raw_paste"] = body.raw_paste
    try:
        decision = await run_decision_engine(
            payload, project["framing"], project["context"], project.get("engine", "claude")
        )
    except AIBackpressureError:
        raise
    except Exception as e:
        logger.exception("decision engine failed")
        raise HTTPException(status_code=502, detail=f"AI engine error: {e}")
    decision_input = {**payload}
    if body.raw_paste:
        decision_input["raw_paste"] = body.raw_paste
    await db.projects.update_one(
        {"id": project_id},
        {
            "$set": {
                "decision_input": decision_input,
                "decision": decision,
                "step": max(4, project.get("step", 3)),
                "updated_at": _now_iso(),
            }
        },
    )
    return await _get_project_or_404(project_id)


# --- STEP 4: ARTIFACTS ---
@api.post("/projects/{project_id}/artifacts", response_model=ProjectOut)
async def step_artifacts(project_id: str, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    if not project.get("decision"):
        raise HTTPException(status_code=400, detail="Complete Decision step first.")
    try:
        artifacts = await run_artifacts(project, project.get("engine", "claude"))
    except AIBackpressureError:
        raise
    except Exception as e:
        logger.exception("artifacts failed")
        raise HTTPException(status_code=502, detail=f"AI engine error: {e}")
    await db.projects.update_one(
        {"id": project_id},
        {
            "$set": {
                "artifacts": artifacts,
                "step": max(5, project.get("step", 4)),
                "updated_at": _now_iso(),
            }
        },
    )
    return await _get_project_or_404(project_id)


# --- STEP 5: CONFIDENCE LOCK-IN ---
async def _run_apply_changes_pipeline(project_id: str, owner_name: str):
    """Background worker for "Apply the changes": maps every client suggestion
    to the step it affects, regenerates those steps + artifacts with the
    changes injected, re-locks, and emails the client an AI-drafted "here's
    what changed" note. Runs as a task — the HTTP request returns immediately
    and the document page polls `applying_changes` until it clears."""
    p = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not p:
        return
    review = p.get("share_review") or {}
    suggestions = (review.get("ai_suggestions") or {}).get("suggestions") or []
    try:
        async def _map(s):
            try:
                mapped = await map_suggestion_to_step(p, s)
            except Exception as e:
                logger.warning("apply-changes mapping failed, defaulting to step 3: %s", e)
                mapped = {"step": 3, "instruction": (s.get("what_to_change") or s.get("title") or "").strip()}
            # Clamp to steps 1-3 — artifacts (4) always regenerate anyway.
            step = min(max(int(mapped.get("step") or 3), 1), 3)
            return {"step": step, "instruction": (mapped.get("instruction") or "").strip(), "title": s.get("title", "")}

        items = [it for it in await asyncio.gather(*[_map(s) for s in suggestions]) if it["instruction"]]
        if not items:
            raise RuntimeError("no mappable changes")
        items.sort(key=lambda it: it["step"])
        first_step = items[0]["step"]
        engine = p.get("engine", "claude")
        rev_block = (
            "\n\n[CLIENT-REQUESTED CHANGES — the client reviewed the document and these updates MUST be reflected]:\n"
            + "\n".join(f"- {it['instruction']}" for it in items)
        )

        # Regenerate the pipeline from the earliest affected step downwards,
        # with the client's changes injected so every output reflects them.
        update: dict = {}
        if first_step <= 1:
            s_in = dict(p.get("situation_input") or {})
            s_in["what"] = (s_in.get("what") or "") + rev_block
            p["framing"] = await run_situation_framing(s_in, engine)
            update.update({"situation_input": s_in, "framing": p["framing"]})
        if first_step <= 2:
            c_in = dict(p.get("context_input") or {})
            c_in["requirements"] = (c_in.get("requirements") or "") + rev_block
            p["context"] = await run_context_compression(c_in, p.get("framing") or {}, engine)
            update.update({"context_input": c_in, "context": p["context"]})
        d_in = dict(p.get("decision_input") or {})
        d_in["optimizing_for"] = (d_in.get("optimizing_for") or "") + rev_block
        p["decision"] = await run_decision_engine(d_in, p.get("framing") or {}, p.get("context") or {}, engine)
        update.update({"decision_input": d_in, "decision": p["decision"]})
        p["artifacts"] = await run_artifacts(p, engine)
        update["artifacts"] = p["artifacts"]

        try:
            change_note = await draft_change_note(p, items, engine)
        except Exception as e:
            logger.warning("change-note drafting failed, using fallback: %s", e)
            change_note = ""
        if not change_note:
            change_note = "I've updated the document based on your feedback:\n" + "\n".join(
                f"- {it['instruction']}" for it in items
            )

        update.update(
            {
                "step": 5,
                "status": "locked",
                "locked_at": _now_iso(),
                "share_status": "sent",
                "revising": False,
                "revision_context": None,
                "applying_changes": False,
                "last_change_note": change_note,
                "updated_at": _now_iso(),
            }
        )
        await db.projects.update_one({"id": project_id}, {"$set": update})

        # Email the client the updated document + what changed (fire-and-forget).
        client_email = review.get("client_email", "")
        if client_email and p.get("share_token"):
            base = os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com").rstrip("/")
            try:
                await send_document_updated_email(
                    client_email=client_email,
                    client_name=review.get("signature_name", ""),
                    owner_name=owner_name,
                    project_name=p.get("name", "your project"),
                    change_note=change_note,
                    share_url=f"{base}/r/{p.get('share_token')}",
                )
            except Exception as e:
                logger.warning(f"document-updated email crashed: {e}")
        logger.info(f"apply-changes pipeline finished for {project_id} (steps {sorted({it['step'] for it in items})})")
    except Exception as e:
        # Leave the project in its rejected state so the owner can retry.
        logger.exception(f"apply-changes pipeline failed for {project_id}: {e}")
        await db.projects.update_one(
            {"id": project_id},
            {"$set": {"applying_changes": False, "updated_at": _now_iso()}},
        )


@api.post("/projects/{project_id}/review/apply-changes")
async def apply_review_changes(project_id: str, request: Request):
    """Kick off the background apply-changes pipeline and return immediately.
    The regeneration chain takes 1-3 minutes (multiple LLM calls) — far past
    proxy timeouts — so the work runs as a task and the frontend polls the
    project's `applying_changes` flag."""
    p = await _get_owned_project_or_404(project_id, request)
    review = p.get("share_review") or {}
    suggestions = (review.get("ai_suggestions") or {}).get("suggestions") or []
    if p.get("share_status") not in ("rejected", "awaiting_reply") or not suggestions:
        raise HTTPException(status_code=400, detail="No client concerns to apply on this project.")
    if p.get("applying_changes"):
        return {"status": "applying"}
    user = await current_user(request, db)
    owner_name = (user or {}).get("name") or (user or {}).get("email") or "The project owner"
    await db.projects.update_one(
        {"id": p["id"]},
        {"$set": {"applying_changes": True, "updated_at": _now_iso()}},
    )
    asyncio.create_task(_run_apply_changes_pipeline(p["id"], owner_name))
    return {"status": "applying"}


@api.post("/projects/{project_id}/lock", response_model=ProjectOut)
async def step_lock(project_id: str, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    if not project.get("artifacts"):
        raise HTTPException(status_code=400, detail="Generate artifacts first.")
    update = {"status": "locked", "locked_at": _now_iso(), "updated_at": _now_iso()}
    resend_to_client = bool(
        project.get("revising") or project.get("share_status") in ("rejected", "awaiting_reply")
    )
    if resend_to_client:
        # The owner edited after concerns were raised — the shared link now
        # serves the new version and the client is asked to re-review.
        update.update({"revising": False, "revision_context": None, "share_status": "sent"})
    await db.projects.update_one({"id": project_id}, {"$set": update})
    if resend_to_client:
        review = project.get("share_review") or {}
        client_email = review.get("client_email", "")
        if client_email and project.get("share_token"):
            base = os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com").rstrip("/")
            try:
                await send_document_updated_email(
                    client_email=client_email,
                    client_name=review.get("signature_name", ""),
                    owner_name=project.get("creator_email") or "The project owner",
                    project_name=project.get("name", "your project"),
                    change_note="The document has been updated in response to your feedback — please take another look.",
                    share_url=f"{base}/r/{project.get('share_token')}",
                )
            except Exception as e:
                logger.warning(f"document-updated email (manual re-lock) crashed: {e}")
    return await _get_project_or_404(project_id)


# --- EXPORT: markdown of a single project (no auth — you just need the id) ---
def _markdown_for(project: dict) -> str:
    lines = [f"# {project.get('name', 'Bracket project')}", ""]
    framing = project.get("framing") or {}
    if framing:
        lines += ["## Reframed problem", framing.get("reframed_problem", ""), ""]
        if framing.get("tensions"):
            lines.append("### Tensions")
            for t in framing["tensions"]:
                lines.append(f"- {t}")
            lines.append("")
    ctx = project.get("context") or {}
    if ctx:
        lines += ["## What actually matters", ctx.get("what_actually_matters", ""), ""]
        if ctx.get("key_signals"):
            lines.append("### Key signals")
            for s in ctx["key_signals"]:
                lines.append(f"- {s}")
            lines.append("")
    decision = project.get("decision") or {}
    if decision:
        rec = decision.get("recommendation") or {}
        lines += [
            "## Decision",
            f"**{rec.get('title','')}** (confidence {rec.get('confidence',0)}%)",
            "",
            rec.get("rationale", ""),
            "",
        ]
        if decision.get("risks"):
            lines.append("### Risks")
            for r in decision["risks"]:
                lines.append(f"- **[{r.get('severity','LOW')}]** {r.get('risk','')} — _{r.get('mitigation','')}_")
            lines.append("")
    artifacts = project.get("artifacts") or {}
    if artifacts:
        scope = artifacts.get("scope_doc") or {}
        lines += [f"## Scope — {scope.get('title','')}"]
        if scope.get("in_scope"):
            lines.append("**In scope**")
            for s in scope["in_scope"]:
                lines.append(f"- {s}")
        if scope.get("out_of_scope"):
            lines.append("\n**Out of scope**")
            for s in scope["out_of_scope"]:
                lines.append(f"- {s}")
        if scope.get("deliverables"):
            lines.append("\n**Deliverables**")
            for d in scope["deliverables"]:
                lines.append(f"- {d}")
        if scope.get("timeline_note"):
            lines.append(f"\n_Timeline:_ {scope['timeline_note']}")
        lines.append("")
        if artifacts.get("client_message"):
            lines += ["## Client message", "", artifacts["client_message"], ""]
        if artifacts.get("assumptions"):
            lines.append("## Assumptions")
            for a in artifacts["assumptions"]:
                lines.append(f"- {a}")
            lines.append("")
        if artifacts.get("risk_flags"):
            lines.append("## Risk flags")
            for r in artifacts["risk_flags"]:
                lines.append(f"- **[{r.get('severity','LOW')}] {r.get('flag','')}** — {r.get('why','')}")
            lines.append("")
    # Client review paper trail — concerns + owner's responses.
    review = project.get("share_review") or {}
    replies = project.get("owner_replies") or []
    if review.get("type") == "reject" and review.get("concerns"):
        lines += ["## Client review — concerns", "", review["concerns"], ""]
        if review.get("signature_name"):
            lines.append(f"_Raised by {review['signature_name']}{(' · ' + review['role']) if review.get('role') else ''}_")
            lines.append("")
    if replies:
        lines.append("## Response to concerns")
        for rep in replies:
            lines += ["", f"**{rep.get('from_name','Owner')}** ({rep.get('sent_at','')[:10]}):", rep.get("text", ""), ""]
    lines.append("\n---\n_Generated by Bracket — the AI decision workspace for client projects._")
    return "\n".join(lines)


@api.get("/projects/{project_id}/export.md", response_class=PlainTextResponse)
async def export_markdown(project_id: str, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    return PlainTextResponse(_markdown_for(project), media_type="text/markdown; charset=utf-8")


# --- PDF EXPORT -----------------------------------------------------------
# Brand accent RGB for the new #5E6AD2 (Linear-inspired violet-blue).
_ACCENT = (94, 106, 210)
_MUTED = (85, 90, 100)
_INK = (0, 0, 0)
_INK_2 = (25, 25, 28)


class _BracketPDF(FPDF):
    def header(self):
        # Thin brand strip — no dark bar, just a subtle accent line.
        self.set_draw_color(*_ACCENT)
        self.set_line_width(0.6)
        self.line(16, 12, 40, 12)
        self.set_xy(16, 14)
        self.set_text_color(*_MUTED)
        self.set_font("Helvetica", "B", 8)
        self.cell(0, 4, "BRACKET  ·  DECISION DOCUMENT", ln=0)
        self.set_text_color(*_INK)
        self.set_y(24)

    def footer(self):
        self.set_y(-14)
        self.set_draw_color(220, 222, 228)
        self.set_line_width(0.2)
        self.line(16, self.get_y() - 2, self.w - 16, self.get_y() - 2)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*_MUTED)
        self.cell(0, 5, f"use-bracket.com  ·  page {self.page_no()} of {{nb}}", align="C")


def _pdf_text(s: str) -> str:
    """fpdf's core fonts are latin-1; substitute common unicode punctuation
    with ASCII equivalents so em-dashes/ellipses/curly-quotes don't become
    "?" glyphs in the exported PDF."""
    if not s:
        return ""
    s = str(s)
    # Common unicode → ASCII substitutions. Explicit high-codepoint fallbacks
    # for characters that appear in AI output (arrows, checks, section marks).
    replacements = {
        "\u2013": "-",   # en dash
        "\u2014": "-",   # em dash
        "\u2015": "-",   # horizontal bar
        "\u2212": "-",   # minus sign
        "\u2026": "...", # ellipsis
        "\u2018": "'", "\u2019": "'", "\u201a": "'",       # curly single
        "\u201c": '"', "\u201d": '"', "\u201e": '"',       # curly double
        "\u00ab": '"', "\u00bb": '"',                       # guillemets
        "\u2022": "*",   # bullet
        "\u25cf": "*",   # black circle
        "\u25a0": "*",   # black square
        "\u2192": "->",  # right arrow
        "\u2190": "<-",  # left arrow
        "\u2194": "<->", # left-right arrow
        "\u2713": "v",   # check
        "\u2717": "x",   # ballot x
        "\u2192\ufe0e": "->",
        "\u00b7": "-",   # middle dot
        "\u2027": "-",   # hyphenation point
        "\u20b9": "Rs.", # rupee
        "\u20ac": "EUR", # euro
        "\u00a3": "GBP", # pound
        "\u2028": " ", "\u2029": " ",  # line/para separator
        "\u00a0": " ",   # nbsp
        "\u200b": "",    # zero-width space
        "\u2011": "-",   # non-breaking hyphen
        "\u00d7": "x",   # multiplication
        "\u00f7": "/",   # division
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    # Decompose accented characters (é → e, ñ → n, etc.) so nothing falls
    # through to the latin-1 "?" fallback.
    try:
        import unicodedata as _u
        s = _u.normalize("NFKD", s)
        s = "".join(c for c in s if not _u.combining(c))
    except Exception:
        pass
    # Final fallback: drop any remaining non-latin-1 char rather than
    # substituting "?" glyphs which read as garbled squares.
    return s.encode("latin-1", "ignore").decode("latin-1")


def _pdf_for(project: dict) -> bytes:
    p = _BracketPDF(orientation="P", unit="mm", format="A4")
    p.alias_nb_pages()
    p.set_auto_page_break(auto=True, margin=20)
    p.set_margins(left=20, top=28, right=20)
    p.add_page()

    # ─── Cover-style title block ────────────────────────────────────────
    # Small tag above the title.
    p.set_font("Helvetica", "B", 8)
    p.set_text_color(*_ACCENT)
    p.cell(0, 5, "SIGN-OFF DOCUMENT", ln=1)
    p.ln(2)

    # Big title.
    p.set_font("Helvetica", "B", 24)
    p.set_text_color(*_INK)
    try:
        p.multi_cell(0, 10, _pdf_text(project.get("name") or "Bracket project"))
    except Exception as exc:
        logger.warning(f"pdf title failed: {exc}")
        p.set_x(p.l_margin)
        p.cell(0, 10, _pdf_text((project.get("name") or "Bracket project")[:60]), ln=1)

    # Meta line under title.
    p.set_font("Helvetica", "", 10)
    p.set_text_color(*_MUTED)
    p.set_x(p.l_margin)
    by = project.get("creator_name") or ""
    when = (project.get("locked_at") or project.get("updated_at") or "")[:10]
    meta_parts = []
    if by:
        meta_parts.append(f"Prepared by {by}")
    if when:
        meta_parts.append(when)
    if meta_parts:
        p.cell(0, 5, _pdf_text("  ·  ".join(meta_parts)), ln=1)

    # Accent divider under title.
    p.ln(5)
    p.set_draw_color(*_ACCENT)
    p.set_line_width(0.4)
    p.line(20, p.get_y(), 60, p.get_y())
    p.ln(8)

    def _reset_x():
        # fpdf2's cell(..., ln=1) doesn't always pull X back to the LEFT margin
        # — it can leave it at the right edge. Call this before every multi_cell
        # so we always have full row width to work with.
        p.set_x(p.l_margin)

    def _safe_multi_cell(width, height, text):
        """multi_cell that survives weird AI output (super-long unbroken tokens,
        unexpected control chars, etc). Always renders SOMETHING."""
        _reset_x()
        safe = _pdf_text(text)
        if not safe:
            return
        try:
            p.multi_cell(width, height, safe)
        except Exception as exc:
            logger.warning(f"pdf multi_cell failed for {safe[:60]!r}: {exc}")
            # Last-ditch: force-break long tokens with soft breaks.
            forced = " ".join(
                [safe[i : i + 80] for i in range(0, len(safe), 80)]
            )
            try:
                _reset_x()
                p.multi_cell(width, height, forced)
            except Exception as exc2:
                logger.warning(f"pdf multi_cell second-pass failed: {exc2}")
                _reset_x()
                p.ln(height)

    def H(s: str):
        # Section heading — big, bold, accent tag above, no gray fill bar.
        p.ln(4)
        p.set_font("Helvetica", "B", 8)
        p.set_text_color(*_ACCENT)
        _reset_x()
        _safe_multi_cell(0, 4, s.upper())
        p.ln(1)
        # Faint hairline under the section tag.
        p.set_draw_color(230, 232, 238)
        p.set_line_width(0.15)
        p.line(20, p.get_y(), p.w - 20, p.get_y())
        p.ln(4)
        p.set_font("Helvetica", "B", 14)
        p.set_text_color(*_INK)

    def SH(s: str, color=_ACCENT):
        p.ln(2)
        p.set_font("Helvetica", "B", 8)
        p.set_text_color(*color)
        _reset_x()
        p.cell(0, 5, _pdf_text(s.upper()), ln=1)
        p.set_text_color(*_INK)

    def P(s: str):
        if not s:
            return
        p.set_font("Helvetica", "", 10.5)
        p.set_text_color(*_INK_2)
        _safe_multi_cell(0, 5.5, s)
        p.ln(1)

    def L(items, bullet="·", muted=False):
        if not items:
            return
        p.set_font("Helvetica", "", 10.5)
        for it in items:
            txt = it if isinstance(it, str) else (it.get("text") or str(it))
            if muted:
                p.set_text_color(*_MUTED)
            else:
                p.set_text_color(*_INK_2)
            _reset_x()
            p.set_x(24)
            p.set_font("Helvetica", "B", 10.5)
            p.set_text_color(*_ACCENT) if not muted else p.set_text_color(*_MUTED)
            p.cell(4, 5.5, _pdf_text(bullet), ln=0)
            p.set_font("Helvetica", "", 10.5)
            p.set_text_color(*_MUTED) if muted else p.set_text_color(*_INK_2)
            try:
                p.multi_cell(0, 5.5, _pdf_text(txt))
            except Exception as exc:
                logger.warning(f"pdf list-item failed: {exc}")
                _reset_x()
                p.set_x(24)
                p.cell(4, 5.5, _pdf_text(bullet), ln=0)
                _safe_multi_cell(0, 5.5, txt)
        p.ln(1)

    framing = project.get("framing") or {}
    if framing:
        H("Reframed problem")
        P(framing.get("reframed_problem") or "")
        if framing.get("what_to_name"):
            SH("What to name out loud")
            P(framing["what_to_name"])
        if framing.get("tensions"):
            SH("Tensions to watch")
            L(framing["tensions"])
        p.ln(2)

    ctx = project.get("context") or {}
    if ctx:
        H("What actually matters")
        P(ctx.get("what_actually_matters") or "")
        if ctx.get("key_signals"):
            SH("Key signals", color=_ACCENT)
            L(ctx["key_signals"], bullet="->")
        if ctx.get("noise_removed"):
            SH("Noise removed", color=_MUTED)
            L(ctx["noise_removed"], bullet="x", muted=True)
        if ctx.get("hidden_assumptions"):
            SH("Hidden assumptions", color=(230, 74, 74))
            L(ctx["hidden_assumptions"], bullet="!")
        p.ln(2)

    decision = project.get("decision") or {}
    if decision:
        rec = decision.get("recommendation") or {}
        H("Decision")
        p.set_font("Helvetica", "B", 13)
        p.set_text_color(*_INK)
        _reset_x()
        try:
            p.multi_cell(0, 7, _pdf_text(rec.get("title") or ""))
        except Exception as exc:
            logger.warning(f"pdf decision-title failed: {exc}")
            _reset_x()
            p.ln(7)
        p.set_font("Helvetica", "I", 10)
        p.set_text_color(*_ACCENT)
        # multi_cell instead of cell — cell(0, …) at width 0 hard-truncates
        # long text (e.g. "Confidence: 100%") on some page geometries.
        _reset_x()
        try:
            p.multi_cell(0, 5, _pdf_text(f"Confidence: {rec.get('confidence', 0)}%"))
        except Exception as exc:
            logger.warning(f"pdf confidence line failed: {exc}")
            _reset_x()
            p.ln(5)
        p.ln(1)
        P(rec.get("rationale") or "")

        if decision.get("alternatives"):
            SH("Alternatives")
            p.set_font("Helvetica", "", 11)
            for alt in decision["alternatives"]:
                p.set_text_color(*_INK)
                p.set_font("Helvetica", "B", 11)
                # multi_cell — alternative titles can be very long ("Accept
                # refresh-only scope NOW, hard-lock the existing brand, ship
                # Webflow site in 10 days with SEO"). Single-line cell()
                # overflows past the right margin — always wrap.
                _safe_multi_cell(0, 6, "- " + (alt.get("title") or ""))
                p.set_font("Helvetica", "", 10)
                p.set_text_color(*_INK_2)
                if alt.get("when_to_choose"):
                    _safe_multi_cell(0, 5, "   When: " + alt["when_to_choose"])
                if alt.get("cost"):
                    _safe_multi_cell(0, 5, "   Cost: " + alt["cost"])
            p.ln(1)

        if decision.get("tradeoffs"):
            SH("Trade-offs")
            L(decision["tradeoffs"], bullet="->")

        if decision.get("risks"):
            SH("Risks", color=(230, 74, 74))
            p.set_font("Helvetica", "", 11)
            for r in decision["risks"]:
                p.set_text_color(230, 74, 74)
                p.set_font("Helvetica", "B", 10)
                _reset_x()
                _safe_multi_cell(0, 6, f"[{r.get('severity', 'LOW')}] {r.get('risk', '')}")
                p.set_text_color(80, 80, 80)
                p.set_font("Helvetica", "", 10)
                if r.get("mitigation"):
                    _safe_multi_cell(0, 5, "   De-risk: " + r["mitigation"])
            p.ln(1)
        p.ln(2)

    artifacts = project.get("artifacts") or {}
    if artifacts:
        scope = artifacts.get("scope_doc") or {}
        if scope:
            H(f"Scope — {scope.get('title','')}")
            if scope.get("in_scope"):
                SH("In scope")
                L(scope["in_scope"])
            if scope.get("out_of_scope"):
                SH("Out of scope", color=_MUTED)
                L(scope["out_of_scope"], muted=True)
            if scope.get("deliverables"):
                SH("Deliverables")
                L(scope["deliverables"])
            if scope.get("timeline_note"):
                SH("Timeline")
                P(scope["timeline_note"])
            p.ln(1)

        if artifacts.get("client_message"):
            H("Client message")
            P(artifacts["client_message"])

        if artifacts.get("assumptions"):
            H("Assumptions")
            L(artifacts["assumptions"])

        if artifacts.get("risk_flags"):
            H("Risk flags")
            p.set_font("Helvetica", "", 11)
            for r in artifacts["risk_flags"]:
                p.set_text_color(230, 74, 74)
                p.set_font("Helvetica", "B", 10)
                _reset_x()
                _safe_multi_cell(0, 6, f"[{r.get('severity','LOW')}] {r.get('flag','')}")
                p.set_text_color(80, 80, 80)
                p.set_font("Helvetica", "", 10)
                if r.get("why"):
                    _safe_multi_cell(0, 5, "   " + r["why"])
            p.ln(1)

    # Footer line
    p.ln(6)
    p.set_draw_color(220, 222, 228)
    p.line(16, p.get_y(), p.w - 16, p.get_y())
    p.ln(3)
    p.set_font("Helvetica", "I", 9)
    p.set_text_color(120, 120, 120)
    _safe_multi_cell(0, 5, "Generated by Bracket — the AI decision workspace for client projects.")

    out = p.output(dest="S")
    if isinstance(out, bytearray):
        out = bytes(out)
    return out


@api.get("/projects/{project_id}/export.pdf")
async def export_pdf(project_id: str, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    safe = "".join(c if c.isalnum() else "-" for c in (project.get("name") or "bracket")).strip("-").lower() or "bracket"
    pdf_bytes = _pdf_for(project)
    headers = {"Content-Disposition": f'attachment; filename="{safe}.pdf"'}
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


# --- FEEDBACK -------------------------------------------------------------
class FeedbackIn(BaseModel):
    sentiment: Literal["up", "down"]
    text: str = Field(default="", max_length=1000)


@api.post("/projects/{project_id}/feedback", response_model=ProjectOut)
async def submit_feedback(project_id: str, body: FeedbackIn, request: Request):
    project = await _get_owned_project_or_404(project_id, request)
    if project.get("status") != "locked":
        raise HTTPException(status_code=400, detail="Feedback is collected after lock-in.")
    feedback = {
        "sentiment": body.sentiment,
        "text": (body.text or "").strip(),
        "submitted_at": _now_iso(),
    }
    await db.projects.update_one(
        {"id": project_id},
        {"$set": {"feedback": feedback, "updated_at": _now_iso()}},
    )
    return await _get_project_or_404(project_id)


# --- SHARE / CLIENT REVIEW -----------------------------------------------
import secrets


def _mk_token() -> str:
    # 16 url-safe chars; collisions are negligible for this volume.
    return secrets.token_urlsafe(12)


def _public_view(project: dict) -> dict:
    """Strip private fields before exposing to client-side share URL viewers."""
    keep = {
        "id", "name", "creator_name", "framing", "decision", "artifacts",
        "share_status", "share_review", "locked_at", "owner_replies",
    }
    return {k: v for k, v in project.items() if k in keep}


@api.post("/projects/{project_id}/share", response_model=ProjectOut)
async def create_share_link(project_id: str, request: Request):
    """Mint (or return existing) public share token for this project."""
    project = await _get_owned_project_or_404(project_id, request)
    if not project.get("artifacts"):
        raise HTTPException(status_code=400, detail="Generate artifacts first.")
    token = project.get("share_token") or _mk_token()
    new_status = project.get("share_status") or "none"
    if new_status in ("none", ""):
        new_status = "sent"
    await db.projects.update_one(
        {"id": project_id},
        {
            "$set": {
                "share_token": token,
                "share_status": new_status,
                "updated_at": _now_iso(),
            }
        },
    )
    return await _get_project_or_404(project_id)


@api.get("/share/{token}")
async def get_shared_document(token: str):
    """Public — anyone with the token can view the document."""
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="This link isn't valid (or has been revoked).")
    return _public_view(project)


class AcceptIn(BaseModel):
    acceptances: Dict[str, bool] = Field(default_factory=dict)
    signature_name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=120)
    client_email: EmailStr


@api.post("/share/{token}/accept")
async def client_accept(token: str, body: AcceptIn):
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="This link isn't valid.")
    if project.get("share_status") in ("accepted", "rejected"):
        raise HTTPException(status_code=409, detail="This document has already been reviewed.")
    # Count accepted items
    accepted_count = sum(1 for v in body.acceptances.values() if v)
    total = len(body.acceptances)
    review = {
        "type": "accept",
        "submitted_at": _now_iso(),
        "signature_name": body.signature_name.strip(),
        "role": (body.role or "").strip(),
        "client_email": str(body.client_email).strip().lower(),
        "acceptances": body.acceptances,
        "accepted_count": accepted_count,
        "total_items": total,
    }
    await db.projects.update_one(
        {"share_token": token},
        {"$set": {"share_status": "accepted", "share_review": review, "updated_at": _now_iso()}},
    )
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    # Fire-and-forget notifications — must never block client response.
    try:
        await send_review_outcome_email(
            owner_email=project.get("creator_email", ""),
            owner_name=project.get("creator_name", ""),
            project_name=project.get("name", ""),
            project_id=project.get("id", ""),
            review=review,
        )
    except Exception as e:
        logger.warning(f"accept outcome email crashed: {e}")
    try:
        await send_push_to_owner(
            db, project,
            "Client accepted ✓",
            f"{review['signature_name']} signed off on “{project.get('name', 'your project')}”.",
            f"/project/{project.get('id', '')}/document",
        )
    except Exception as e:
        logger.warning(f"accept push crashed: {e}")
    # Also mail the client — with the signed PDF attached — as a receipt.
    try:
        pdf_bytes = _pdf_for(project)
        safe_name = "".join(c if c.isalnum() else "-" for c in (project.get("name") or "bracket")).strip("-").lower() or "bracket"
        base = os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com").rstrip("/")
        share_url = f"{base}/r/{token}"
        await send_client_receipt_email(
            client_email=review["client_email"],
            project_name=project.get("name", ""),
            review=review,
            share_url=share_url,
            pdf_bytes=pdf_bytes,
            pdf_filename=f"{safe_name}-signed.pdf",
        )
    except Exception as e:
        logger.warning(f"client receipt (accept) email crashed: {e}")
    return _public_view(project)


class RejectPreviewIn(BaseModel):
    concerns: str = Field(min_length=4, max_length=4000)


@api.post("/share/{token}/reject/preview")
async def client_reject_preview(token: str, body: RejectPreviewIn):
    """Show the client AI-generated suggestions BEFORE they finalize the rejection.
    Doesn't mutate share_status — that happens on /reject/confirm."""
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="This link isn't valid.")
    if project.get("share_status") in ("accepted", "rejected"):
        raise HTTPException(status_code=409, detail="This document has already been reviewed.")
    try:
        suggestions = await run_client_pushback_suggestions(
            project, body.concerns, project.get("engine", "claude")
        )
    except AIBackpressureError:
        raise
    except Exception as e:
        logger.exception("pushback suggestions failed")
        raise HTTPException(status_code=502, detail=f"AI engine error: {e}")
    # NOTE: `suggestions` is guaranteed assigned here — the except branch
    # raises and exits. The static analyzer can't see `raise` as terminal.
    return {"concerns": body.concerns.strip(), "ai_suggestions": suggestions}  # noqa: F821


class RejectConfirmIn(BaseModel):
    concerns: str = Field(min_length=4, max_length=4000)
    signature_name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=120)
    client_email: EmailStr
    ai_suggestions: Dict[str, Any] = Field(default_factory=dict)


@api.post("/share/{token}/reject/confirm")
async def client_reject_confirm(token: str, body: RejectConfirmIn):
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="This link isn't valid.")
    if project.get("share_status") in ("accepted", "rejected"):
        raise HTTPException(status_code=409, detail="This document has already been reviewed.")
    review = {
        "type": "reject",
        "submitted_at": _now_iso(),
        "signature_name": body.signature_name.strip(),
        "role": (body.role or "").strip(),
        "client_email": str(body.client_email).strip().lower(),
        "concerns": body.concerns.strip(),
        "ai_suggestions": body.ai_suggestions,
    }
    await db.projects.update_one(
        {"share_token": token},
        {"$set": {"share_status": "rejected", "share_review": review, "updated_at": _now_iso()}},
    )
    project = await db.projects.find_one({"share_token": token}, {"_id": 0})
    # Fire-and-forget owner notification.
    try:
        await send_review_outcome_email(
            owner_email=project.get("creator_email", ""),
            owner_name=project.get("creator_name", ""),
            project_name=project.get("name", ""),
            project_id=project.get("id", ""),
            review=review,
        )
    except Exception as e:
        logger.warning(f"reject outcome email crashed: {e}")
    try:
        await send_push_to_owner(
            db, project,
            "Client raised concerns",
            f"{review['signature_name']} flagged concerns on “{project.get('name', 'your project')}”. Tap to review.",
            f"/project/{project.get('id', '')}/document",
        )
    except Exception as e:
        logger.warning(f"reject push crashed: {e}")
    # Send the client a receipt echoing back their concerns.
    try:
        base = os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com").rstrip("/")
        share_url = f"{base}/r/{token}"
        await send_client_receipt_email(
            client_email=review["client_email"],
            project_name=project.get("name", ""),
            review=review,
            share_url=share_url,
        )
    except Exception as e:
        logger.warning(f"client receipt (reject) email crashed: {e}")
    return _public_view(project)


# ─── Plans (server-side pricing; INR via Razorpay) ───────────────────────
# Fixed, server-side pricing. The client only sends a plan id; amounts are
# never trusted from the frontend.
PLANS = {
    "monthly": {"amount": 12.0, "amount_inr": 999.0, "label": "Bracket Monthly", "kind": "subscription", "interval": "month"},
    "project": {"amount": 2.0, "amount_inr": 199.0, "label": "Bracket Single Project", "kind": "payment"},
    "test": {"amount": 0.0, "amount_inr": 0.0, "label": "Bracket Test (free)", "kind": "subscription", "interval": "month"},
}


def _plan_amount(plan: dict, currency: str) -> float:
    return plan["amount_inr"] if currency == "inr" else plan["amount"]


# ─── Razorpay (INR: UPI + cards + netbanking) ──────────────────────────────
import razorpay as _razorpay


def _razorpay_client():
    kid = os.environ.get("RAZORPAY_KEY_ID")
    ksec = os.environ.get("RAZORPAY_KEY_SECRET")
    if not kid or not ksec:
        raise HTTPException(status_code=500, detail="Razorpay is not configured.")
    return _razorpay.Client(auth=(kid, ksec)), kid


class RzpOrderIn(BaseModel):
    plan_id: str
    currency: str = "inr"


@api.post("/payments/razorpay/order")
async def razorpay_create_order(body: RzpOrderIn, request: Request):
    plan = PLANS.get(body.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Unknown plan.")
    if body.plan_id in ("test", "ph_launch"):
        raise HTTPException(status_code=400, detail="This plan is activated directly, not via checkout.")
    currency = (body.currency or "inr").lower()
    if currency not in ("inr", "usd"):
        raise HTTPException(status_code=400, detail="Unsupported currency.")
    user = await current_user(request, db)
    client, key_id = _razorpay_client()
    amount = _plan_amount(plan, currency)
    amount_minor = int(round(amount * 100))
    if amount_minor < 100:
        raise HTTPException(status_code=400, detail="Amount below minimum.")
    receipt = f"bkt_{body.plan_id}_{user['user_id']}"[:40]
    try:
        order = client.order.create({
            "amount": amount_minor,
            "currency": currency.upper(),
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {"user_id": user["user_id"], "plan_id": body.plan_id},
        })
    except _razorpay.errors.BadRequestError as e:
        logger.warning(f"razorpay order bad request ({currency}): {e}")
        # USD requires Razorpay international payments to be enabled on the account.
        if currency == "usd":
            raise HTTPException(status_code=400, detail="USD payments aren't enabled on this account yet. Please pay in INR.")
        raise HTTPException(status_code=400, detail="Could not create the order.")
    except Exception as e:
        logger.exception(f"razorpay order failed: {e}")
        raise HTTPException(status_code=500, detail="Payment provider error.")
    await db.payment_transactions.insert_one({
        "session_id": order["id"],  # razorpay_order_id doubles as our session ref
        "provider": "razorpay",
        "user_id": user["user_id"],
        "plan_id": body.plan_id,
        "amount": amount,
        "currency": currency,
        "kind": plan["kind"],
        "status": "initiated",
        "payment_status": "pending",
        "created_at": auth_iso(auth_now()),
        "updated_at": auth_iso(auth_now()),
    })
    return {"order_id": order["id"], "amount": amount_minor, "currency": currency.upper(),
            "key_id": key_id, "plan_label": plan["label"]}


class RzpVerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


async def _fulfill_razorpay(order_id: str, payment_id: str, expected_user_id: str = None):
    """Idempotently marks a Razorpay order paid, activates the plan, and emails
    the receipt once. Shared by /verify (browser) and /webhook (safety net)."""
    rec = await db.payment_transactions.find_one({"session_id": order_id}, {"_id": 0})
    if not rec:
        return False, 404
    if expected_user_id and rec.get("user_id") != expected_user_id:
        return False, 403
    if rec.get("payment_status") == "paid":
        return True, 200
    res = await db.payment_transactions.update_one(
        {"session_id": order_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"status": "completed", "payment_status": "paid",
                  "razorpay_payment_id": payment_id, "updated_at": auth_iso(auth_now())}},
    )
    uid = rec.get("user_id")
    pid = rec.get("plan_id")
    plan_meta = PLANS.get(pid) or {}
    if uid and pid:
        await db.users.update_one(
            {"user_id": uid},
            {"$set": {"plan": pid, "plan_kind": plan_meta.get("kind", "payment"),
                      "plan_currency": "inr", "plan_since": auth_iso(auth_now()),
                      "updated_at": auth_iso(auth_now())}},
        )
    if res.modified_count == 1 and uid:
        try:
            u = await db.users.find_one({"user_id": uid}, {"_id": 0, "email": 1, "name": 1})
            if u and u.get("email"):
                asyncio.create_task(send_payment_receipt(
                    to_email=u["email"], name=u.get("name", ""),
                    plan_label=plan_meta.get("label", "Bracket"),
                    amount=rec.get("amount"), currency="inr",
                    recurring=(plan_meta.get("kind") == "subscription"),
                    session_id=payment_id,
                    public_base_url=os.environ.get("PUBLIC_BASE_URL", ""),
                ))
        except Exception as e:
            logger.warning(f"razorpay receipt scheduling failed: {e}")
    return True, 200


class TestPlanToggleIn(BaseModel):
    enabled: bool


@api.get("/admin/test-plan")
async def admin_get_test_plan(request: Request):
    await auth_current_admin(request, db)
    return {"enabled": bool(TEST_PLAN_STATE.get("enabled"))}


@api.post("/admin/test-plan")
async def admin_set_test_plan(body: TestPlanToggleIn, request: Request):
    admin = await auth_current_admin(request, db)
    await db.app_settings.update_one(
        {"key": "test_plan"},
        {"$set": {"key": "test_plan", "enabled": bool(body.enabled),
                  "updated_at": auth_iso(auth_now()), "updated_by": admin.get("email")}},
        upsert=True,
    )
    TEST_PLAN_STATE["enabled"] = bool(body.enabled)
    logger.info("[test-plan] toggle set to %s by %s", body.enabled, admin.get("email"))
    return {"enabled": bool(body.enabled)}


@api.post("/payments/test-activate")
async def test_activate_plan(request: Request):
    """Removed. The free ₹0 test plan has been fully retired from the product;
    this endpoint now rejects so no account can self-activate a free plan."""
    await current_user(request, db)
    raise HTTPException(status_code=410, detail="The test plan has been removed.")


class PhLaunchToggleIn(BaseModel):
    enabled: bool


@api.get("/admin/ph-launch")
async def admin_get_ph_launch(request: Request):
    await auth_current_admin(request, db)
    return {"enabled": bool(PH_LAUNCH_STATE.get("enabled"))}


@api.get("/public/ph-launch")
async def public_get_ph_launch():
    """Public (no auth) — lets the marketing homepage show/hide the launch ribbon."""
    return {"enabled": bool(PH_LAUNCH_STATE.get("enabled"))}


@api.post("/admin/ph-launch")
async def admin_set_ph_launch(body: PhLaunchToggleIn, request: Request):
    admin = await auth_current_admin(request, db)
    await db.app_settings.update_one(
        {"key": "ph_launch"},
        {"$set": {"key": "ph_launch", "enabled": bool(body.enabled),
                  "updated_at": auth_iso(auth_now()), "updated_by": admin.get("email")}},
        upsert=True,
    )
    PH_LAUNCH_STATE["enabled"] = bool(body.enabled)
    logger.info("[ph-launch] toggle set to %s by %s", body.enabled, admin.get("email"))
    return {"enabled": bool(body.enabled)}


@api.post("/payments/ph-activate")
async def ph_activate_plan(request: Request):
    """Product Hunt launch offer: activate a free 14-day single-project plan,
    no card. Guarded by the admin toggle + one claim per account."""
    user = await current_user(request, db)
    if not can_use_ph_launch(user):
        raise HTTPException(status_code=403, detail="The launch offer isn't available for this account.")
    now = auth_iso(auth_now())
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"plan": "ph_launch", "plan_kind": "ph_launch", "plan_currency": "inr",
                  "plan_since": now, "ph_claimed": True, "updated_at": now}},
    )
    logger.info(f"[ph-launch] activated free launch plan for {user.get('email')}")
    return {"success": True}


@api.post("/payments/razorpay/verify")
async def razorpay_verify_payment(body: RzpVerifyIn, request: Request):
    if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Missing payment fields.")
    user = await current_user(request, db)
    client, _ = _razorpay_client()
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": body.razorpay_order_id,
            "razorpay_payment_id": body.razorpay_payment_id,
            "razorpay_signature": body.razorpay_signature,
        })
    except _razorpay.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Payment verification failed.")
    ok, code = await _fulfill_razorpay(body.razorpay_order_id, body.razorpay_payment_id, expected_user_id=user["user_id"])
    if not ok:
        raise HTTPException(status_code=code, detail="Order not found." if code == 404 else "This checkout doesn't belong to you.")
    return {"success": True}



def _renewal_iso(plan_id: str, plan_since: str):
    from datetime import datetime, timedelta
    if not plan_since:
        return None
    try:
        start = datetime.fromisoformat(plan_since)
    except Exception:
        return None
    if plan_id == "monthly":
        return (start + timedelta(days=30)).isoformat()
    if plan_id == "project":
        return (start + timedelta(days=60)).isoformat()
    return None


@api.get("/payments/billing")
async def payments_billing(request: Request):
    user = await current_user(request, db)
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    plan_id = u.get("plan")
    plan_meta = PLANS.get(plan_id) if plan_id else None
    currency = u.get("plan_currency") or "usd"
    return {
        "plan": plan_id,
        "plan_kind": u.get("plan_kind") or (plan_meta or {}).get("kind"),
        "label": (plan_meta or {}).get("label"),
        "amount": _plan_amount(plan_meta, currency) if plan_meta else None,
        "currency": currency,
        "since": u.get("plan_since"),
        "renews_on": _renewal_iso(plan_id, u.get("plan_since")) if plan_id else None,
        "recurring": bool(plan_meta and plan_meta.get("kind") == "subscription"),
    }


@api.post("/payments/cancel")
async def payments_cancel(request: Request):
    # Clears the user's plan. On the shared sandbox we can't hold a Stripe
    # subscription id (status reads are unavailable), so cancellation is applied
    # locally; a real Stripe account would also cancel the subscription here.
    user = await current_user(request, db)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"plan": None, "plan_kind": None, "plan_since": None, "updated_at": auth_iso(auth_now())}},
    )
    return {"ok": True}


@api.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    # Safety net: confirms a payment even if the browser closes before the
    # /verify call runs. Razorpay signs the raw body with the webhook secret
    # configured in the dashboard; we verify before trusting anything.
    import json
    body = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="Webhook not configured.")
    client, _ = _razorpay_client()
    try:
        client.utility.verify_webhook_signature(body.decode("utf-8"), sig, secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload.")
    event = payload.get("event")
    ent = payload.get("payload", {}) or {}
    order_id = payment_id = None
    if event == "order.paid":
        order_id = (((ent.get("order") or {}).get("entity") or {}).get("id"))
        payment_id = (((ent.get("payment") or {}).get("entity") or {}).get("id"))
    elif event == "payment.captured":
        pay = (ent.get("payment") or {}).get("entity") or {}
        order_id = pay.get("order_id")
        payment_id = pay.get("id")
    if order_id:
        await _fulfill_razorpay(order_id, payment_id)
    return {"status": "ok"}



# --- Mount router ---
app.include_router(api)

# --- Connect Work (source connections) router + background poller ---
import connectors as _connectors  # noqa: E402
app.include_router(_connectors.router)

# --- Demo Workspace (sandbox) router ---
import demo as _demo  # noqa: E402
app.include_router(_demo.router)


@app.on_event("startup")
async def _start_connector_poller():
    asyncio.create_task(_connectors.poller_loop())
    asyncio.create_task(_connectors.scope_digest_loop())

_cors_env = os.environ.get("CORS_ORIGINS", "*").strip()
# Scoped fallback regex — only Bracket's own domains (prod, emergent host, preview,
# local dev). NEVER reflect arbitrary origins with credentials (that lets any site
# read a signed-in user's data). Set CORS_ORIGINS explicitly in production.
_DEFAULT_CORS_REGEX = (
    r"^https?://(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|"
    r"([a-z0-9-]+\.)*(use-bracket\.com|emergent\.host|emergentagent\.com))$"
)
if _cors_env in ("", "*"):
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=_DEFAULT_CORS_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _cors_env.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    # Clickjacking protection — forbid the app/API from being framed by any site.
    response.headers["X-Frame-Options"] = "DENY"
    response.headers.setdefault("Content-Security-Policy", "frame-ancestors 'none'")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


@app.on_event("startup")
async def on_startup():
    """Defensive startup: index creation must NEVER crash the server.

    Production hit a bug here when the legacy `users` collection contained
    documents with `user_id: null` or `email: null` (left over from earlier
    deploy attempts). The original unique index on those fields then refused
    to build → uvicorn exited → every request returned Cloudflare 520.

    The fixes below are layered:
      1. Each create_index is wrapped in its own try/except — one failure
         can't take down the whole startup hook.
      2. Unique indexes use `partialFilterExpression` so legacy null/missing
         values are excluded from the uniqueness constraint.
      3. Best-effort cleanup of orphan rows BEFORE indexing.
    """
    async def _safe_index(coll, keys, **kwargs):
        try:
            await coll.create_index(keys, **kwargs)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[startup] index {keys} on {coll.name} skipped: {e}")

    # 1) Best-effort cleanup of orphan rows that would block unique indexes.
    try:
        # A restart mid-pipeline would leave apply-changes flags stuck true.
        r = await db.projects.update_many(
            {"applying_changes": True}, {"$set": {"applying_changes": False}}
        )
        if r.modified_count:
            logger.info(f"[startup] cleared {r.modified_count} stale applying_changes flags")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] applying_changes cleanup skipped: {e}")
    try:
        r = await db.users.delete_many({
            "$or": [
                {"user_id": {"$in": [None, ""]}},
                {"email":   {"$in": [None, ""]}},
            ]
        })
        if r.deleted_count:
            logger.info(f"[startup] removed {r.deleted_count} orphan user rows")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] orphan-user cleanup skipped: {e}")
    try:
        r = await db.user_sessions.delete_many({
            "$or": [
                {"session_token": {"$in": [None, ""]}},
                {"user_id":       {"$in": [None, ""]}},
            ]
        })
        if r.deleted_count:
            logger.info(f"[startup] removed {r.deleted_count} orphan session rows")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] orphan-session cleanup skipped: {e}")
    try:
        r = await db.email_otps.delete_many({"email": {"$in": [None, ""]}})
        if r.deleted_count:
            logger.info(f"[startup] removed {r.deleted_count} orphan otp rows")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] orphan-otp cleanup skipped: {e}")

    # 2) Project indexes — non-unique, safe.
    await _safe_index(db.projects, "created_at")
    await _safe_index(db.projects, [("creator_email", 1), ("updated_at", -1)])
    await _safe_index(db.projects, [("creator_email", 1), ("name", 1)])
    await _safe_index(db.projects, [("owner_user_id", 1), ("updated_at", -1)])
    # Demo workspace: one demo project per owner (bulletproof idempotency).
    await _safe_index(
        db.projects, [("owner_user_id", 1), ("demo_tag", 1)],
        unique=True,
        partialFilterExpression={"demo_tag": {"$type": "string"}},
    )

    # 3) Auth indexes — unique but partial so legacy nulls don't poison them.
    # Use string-type filter so only real values participate in the constraint.
    await _safe_index(
        db.users, "email",
        unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )
    await _safe_index(
        db.users, "user_id",
        unique=True,
        partialFilterExpression={"user_id": {"$type": "string"}},
    )
    await _safe_index(
        db.user_sessions, "session_token",
        unique=True,
        partialFilterExpression={"session_token": {"$type": "string"}},
    )
    await _safe_index(db.user_sessions, "user_id")
    await _safe_index(
        db.email_otps, "email",
        unique=True,
        partialFilterExpression={"email": {"$type": "string"}},
    )

    # Load the temporary ₹0 test-plan toggle into memory (admin-controlled).
    try:
        _tp = await db.app_settings.find_one({"key": "test_plan"})
        TEST_PLAN_STATE["enabled"] = bool(_tp and _tp.get("enabled"))
        logger.info("[startup] test_plan toggle = %s", TEST_PLAN_STATE["enabled"])
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] test_plan toggle load skipped: {e}")
    # Load the Product Hunt launch-offer toggle into memory (admin-controlled).
    try:
        _ph = await db.app_settings.find_one({"key": "ph_launch"})
        PH_LAUNCH_STATE["enabled"] = bool(_ph and _ph.get("enabled"))
        logger.info("[startup] ph_launch toggle = %s", PH_LAUNCH_STATE["enabled"])
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] ph_launch toggle load skipped: {e}")

    # 4) Purge legacy/decommissioned accounts declared via PURGE_USER_EMAILS
    #    (comma-separated). Idempotent + cascades projects/sessions/OTPs. Guarded
    #    so it can NEVER delete a currently-active admin (ADMIN_EMAILS / bootstrap).
    try:
        from auth import admin_emails as _admin_emails
        protected = _admin_emails()  # effective allowlist (honors override, already excludes PURGE)
        purge_emails = [
            e.strip().lower()
            for e in (os.environ.get("PURGE_USER_EMAILS", "").split(","))
            if e.strip() and e.strip().lower() not in protected
        ]
        if purge_emails:
            victims = await db.users.find(
                {"email": {"$in": purge_emails}}, {"_id": 0, "user_id": 1, "email": 1}
            ).to_list(length=1000)
            if victims:
                vids = [v["user_id"] for v in victims]
                vemails = [v["email"] for v in victims if v.get("email")]
                await db.projects.delete_many(
                    {"$or": [{"owner_user_id": {"$in": vids}}, {"creator_email": {"$in": vemails}}]}
                )
                await db.user_sessions.delete_many({"user_id": {"$in": vids}})
                if vemails:
                    await db.email_otps.delete_many({"email": {"$in": vemails}})
                await db.users.delete_many({"user_id": {"$in": vids}})
                logger.info(f"[startup] purged legacy accounts: {vemails}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] legacy account purge skipped: {e}")

    # 5) Seed admin user(s) declared via ADMIN_EMAILS env var. Idempotent —
    #    if the user already exists their password is left alone; only the
    #    bootstrap admin (matching BOOTSTRAP_ADMIN_EMAIL with BOOTSTRAP_ADMIN_PASSWORD)
    #    is seeded with a default password the first time.
    try:
        _override_raw = (os.environ.get("ADMIN_EMAILS_OVERRIDE") or "").strip()
        bootstrap_email = (
            _override_raw.split(",")[0].strip().lower() if _override_raw
            else (os.environ.get("BOOTSTRAP_ADMIN_EMAIL") or "").strip().lower()
        )
        bootstrap_pw = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or ""
        if bootstrap_email and bootstrap_pw:
            existing = await db.users.find_one({"email": bootstrap_email}, {"_id": 0, "user_id": 1, "password_hash": 1, "name": 1})
            if not existing:
                from auth import gen_user_id as _gen_uid
                doc = {
                    "user_id": _gen_uid(),
                    "email": bootstrap_email,
                    "name": "Bracket Admin",
                    "designation": "Founder",
                    "avatar": "mono-1",
                    "picture": "",
                    "password_hash": hash_password(bootstrap_pw),
                    "created_at": auth_iso(auth_now()),
                    "updated_at": auth_iso(auth_now()),
                }
                await db.users.insert_one(doc)
                logger.info(f"[startup] seeded bootstrap admin {bootstrap_email}")
            elif not verify_password(bootstrap_pw, existing.get("password_hash") or ""):
                # Guarantee the bootstrap admin can log in with BOOTSTRAP_ADMIN_PASSWORD.
                await db.users.update_one(
                    {"user_id": existing["user_id"]},
                    {"$set": {"password_hash": hash_password(bootstrap_pw), "updated_at": auth_iso(auth_now())}},
                )
                logger.info(f"[startup] (re)set bootstrap admin password for {bootstrap_email}")
            if existing and (existing.get("name") or "").strip().lower() == "saksham shukla":
                # Normalize legacy admin display-name off the personal identity.
                await db.users.update_one(
                    {"user_id": existing["user_id"]},
                    {"$set": {"name": "Bracket Admin", "updated_at": auth_iso(auth_now())}},
                )
                logger.info(f"[startup] normalized bootstrap admin name for {bootstrap_email}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[startup] bootstrap admin seed skipped: {e}")

    logger.info("bracket api ready (auth mode)")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
