"""Bracket admin panel API — owner only (Figma › 13 Admin panel).

Separate from product accounts on purpose:

* One username + password, set on the server only:
    ADMIN_USERNAME          plain username
    ADMIN_PASSWORD_HASH     bcrypt hash  (python backend/scripts/admin_hash.py)
  If either is missing every sign-in is refused (fails closed).
* A 30-minute sliding session in an httpOnly, SameSite=Strict cookie scoped to
  /api/v2/admin. Only a SHA-256 of the token is stored.
* 5 wrong attempts from one address → 15-minute pause (stored in Mongo so it
  survives restarts and works across workers).
* Every sign-in, failure and action is written to `admin_audit`.
* Responses carry counts and metadata only — never message or note content.

Contract: docs/API_V2.md § Admin. The mock (mock/admin.js) mirrors it.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from passlib.hash import bcrypt as _bcrypt
from pydantic import BaseModel, Field

from connectors import db

logger = logging.getLogger("bracket.admin")
router = APIRouter(prefix="/api/v2/admin")

COOKIE = "bk_admin"
COOKIE_PATH = "/api/v2/admin"
SESSION_MIN = 30
MAX_ATTEMPTS = 5
PAUSE_MIN = 15
FX = float(os.environ.get("ADMIN_FX_INR_PER_USD", "83"))
PRICE = {"monthly": {"usd": 12, "inr": 999}, "project": {"usd": 2, "inr": 199}}
PROVIDERS = ["gmail", "slack", "notes", "files", "meetings"]
# Any password check costs the same whether or not the username matched.
_DUMMY_HASH = _bcrypt.hash("bracket-admin-timing-pad")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))[:64]


def _err(status: int, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, **extra})


async def _audit(action: str, ip: str, detail: Optional[dict] = None) -> None:
    try:
        await db.admin_audit.insert_one({"id": secrets.token_hex(8), "at": _iso(_now()), "action": action, "ip": ip, "detail": detail})
    except Exception:  # auditing must never break the request
        logger.exception("admin audit write failed")


# ───────────────────────── session ─────────────────────────
class AdminSessionError(Exception):
    """Raised when there is no live admin session → 401 { code: admin_session }."""


async def require_admin(request: Request) -> Dict[str, Any]:
    token = request.cookies.get(COOKIE)
    if token:
        s = await db.admin_sessions.find_one({"token_hash": _sha(token)}, {"_id": 0})
        if s and (_dt(s.get("expires_at")) or _now()) > _now():
            expires = _now() + timedelta(minutes=SESSION_MIN)
            await db.admin_sessions.update_one({"token_hash": s["token_hash"]}, {"$set": {"expires_at": _iso(expires)}})
            s["expires_at"] = _iso(expires)
            return s
        if s:
            await db.admin_sessions.delete_one({"token_hash": s["token_hash"]})
    raise AdminSessionError()


def _set_cookie(request: Request, response: Response, token: str, max_age: int) -> None:
    response.set_cookie(COOKIE, token, max_age=max_age, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https" or os.environ.get("ADMIN_COOKIE_SECURE") == "1", path=COOKIE_PATH)


class LoginIn(BaseModel):
    username: str = Field("", max_length=200)
    password: str = Field("", max_length=500)


@router.post("/login")
async def login(body: LoginIn, request: Request):
    ip = _ip(request)
    want_user = os.environ.get("ADMIN_USERNAME", "")
    want_hash = os.environ.get("ADMIN_PASSWORD_HASH", "")
    a = await db.admin_login_attempts.find_one({"ip": ip}, {"_id": 0}) or {"ip": ip, "fails": 0}
    paused_until = _dt(a.get("paused_until"))
    if paused_until and paused_until > _now():
        await _audit("sign_in_blocked", ip)
        return _err(429, "Sign-in is paused for 15 minutes.", code="admin_paused", retry_at=_iso(paused_until))

    user_ok = bool(want_user) and hmac.compare_digest(body.username.strip().encode(), want_user.encode())
    try:
        pass_ok = _bcrypt.verify(body.password, want_hash or _DUMMY_HASH) and bool(want_hash)
    except Exception:
        pass_ok = False
    if not (user_ok and pass_ok):
        fails = int(a.get("fails") or 0) + 1
        update: Dict[str, Any] = {"ip": ip, "fails": fails, "last_at": _iso(_now())}
        if fails >= MAX_ATTEMPTS:
            update.update(fails=0, paused_until=_iso(_now() + timedelta(minutes=PAUSE_MIN)))
        await db.admin_login_attempts.update_one({"ip": ip}, {"$set": update}, upsert=True)
        await _audit("sign_in_failed", ip, {"configured": bool(want_user and want_hash)})
        if "paused_until" in update:
            return _err(429, "Sign-in is paused for 15 minutes.", code="admin_paused", retry_at=update["paused_until"])
        return _err(401, "Incorrect username or password.", code="admin_credentials", attempts_left=MAX_ATTEMPTS - fails)

    await db.admin_login_attempts.delete_one({"ip": ip})
    token = secrets.token_urlsafe(32)
    expires = _now() + timedelta(minutes=SESSION_MIN)
    await db.admin_sessions.insert_one({"token_hash": _sha(token), "created_at": _iso(_now()), "expires_at": _iso(expires), "ip": ip})
    await _audit("sign_in", ip)
    resp = JSONResponse({"ok": True, "username": want_user, "expires_at": _iso(expires)})
    _set_cookie(request, resp, token, SESSION_MIN * 60)
    return resp


@router.get("/session")
async def session(request: Request):
    s = await require_admin(request)
    return {"username": os.environ.get("ADMIN_USERNAME", ""), "expires_at": s["expires_at"], "minutes": SESSION_MIN}


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get(COOKIE)
    if token:
        await db.admin_sessions.delete_one({"token_hash": _sha(token)})
    await _audit("sign_out", _ip(request))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path=COOKIE_PATH)
    return resp


# ───────────────────────── customer model ─────────────────────────
# A light view over `users` + `projects` + `source_connections`. Fields written
# by v2 billing (plan_status, trial_ends_at, canceled_at, retry) are used when
# present; v1.9 accounts fall back to `plan` / `plan_since` / `created_at`.
_USER_FIELDS = {"_id": 0, "password_hash": 0, "push_subscription": 0}


def _customer(u: dict, projects: int, sources: List[str], sync_error: Optional[str]) -> dict:
    created = _dt(u.get("created_at")) or _now()
    plan = u.get("plan") if u.get("plan") in ("monthly", "project") else None
    cur = (u.get("plan_currency") or ("inr" if u.get("country") == "IN" else "usd")).lower()
    trial_end = _dt(u.get("trial_ends_at")) or created + timedelta(days=14)
    paid_since = _dt(u.get("plan_since")) if plan else None
    st = (u.get("plan_status") or "").lower()
    if u.get("suspended"):
        status = "suspended"
    elif plan == "monthly":
        status = {"past_due": "past_due", "canceled": "canceled"}.get(st, "paying")
    elif plan == "project":
        status = "paying" if paid_since and _now() - paid_since < timedelta(days=60) else "expired"
    else:
        status = "trial" if trial_end > _now() else "expired"
    label = {"suspended": "Suspended", "past_due": "Past due", "canceled": "Canceled", "trial": "Trial"}.get(status) or (
        "Monthly" if plan == "monthly" else "Per project" if plan == "project" and status == "paying" else "Project ended" if plan == "project" else "Expired")
    mrr = None
    if plan == "monthly" and status in ("paying", "past_due"):
        mrr = {"amount": PRICE["monthly"][cur], "currency": cur}
    elif plan == "project" and status == "paying":
        mrr = {"amount": PRICE["project"][cur], "currency": cur, "one_time": True}
    days = max(1, (_now() - created).days + 1)
    length = max(1, round((trial_end - created).total_seconds() / 86400))
    return {
        "id": u["user_id"], "name": u.get("name") or (u.get("email") or "").split("@")[0], "email": u.get("email") or "",
        "company": u.get("company") or u.get("business") or "", "plan": plan or "trial", "status": status, "plan_label": label,
        "trial_day": min(days, length) if status == "trial" else None, "trial_length": length,
        "projects": projects, "sources": sources, "sync_error": sync_error,
        "last_active_at": u.get("last_seen_at") or u.get("updated_at") or u.get("created_at"),
        "created_at": _iso(created), "trial_ends_at": _iso(trial_end), "paid_since": _iso(paid_since),
        "canceled_at": u.get("canceled_at"), "mrr": mrr, "currency": cur, "from_sandbox": bool(u.get("from_sandbox")),
        "_u": u,
    }


async def _customers() -> List[dict]:
    users = await db.users.find({"is_sandbox": {"$ne": True}, "is_guest": {"$ne": True}}, _USER_FIELDS).to_list(length=100_000)
    proj = {r["_id"]: r["n"] async for r in db.projects.aggregate([
        {"$match": {"is_demo": {"$ne": True}, "archived": {"$ne": True}}},
        {"$group": {"_id": "$owner_user_id", "n": {"$sum": 1}}}])}
    src: Dict[str, set] = {}
    err: Dict[str, str] = {}
    async for c in db.source_connections.find({"is_demo": {"$ne": True}}, {"_id": 0, "user_id": 1, "provider": 1, "status": 1}):
        p = {"meeting": "meetings", "note": "notes", "file": "files"}.get(c.get("provider"), c.get("provider"))
        src.setdefault(c.get("user_id"), set()).add(p)
        if c.get("status") in ("error", "expired", "revoked", "disconnected_error"):
            err[c.get("user_id")] = p
    return [_customer(u, proj.get(u["user_id"], 0), sorted(src.get(u["user_id"], set())), err.get(u["user_id"])) for u in users]


def _public(c: dict) -> dict:
    return {k: v for k, v in c.items() if not k.startswith("_") and k not in ("sync_error", "trial_ends_at", "paid_since", "canceled_at", "currency")}


def _within(iso: Optional[str], days: int, offset: int = 0) -> bool:
    d = _dt(iso)
    return bool(d) and _now() - timedelta(days=days + offset) <= d < _now() - timedelta(days=offset)


def _fx(amount: float, frm: str, to: str) -> float:
    return amount if frm == to else (amount / FX if frm == "inr" else amount * FX)


def _pct(a: float, b: float) -> float:
    return round(a / b * 100, 1) if b else 0


def _delta(cur: float, prev: float) -> Optional[int]:
    return round((cur - prev) / prev * 100) if prev else None


def _mrr(c: dict, cur: str) -> float:
    m = c["mrr"]
    return _fx(m["amount"], m["currency"], cur) if m and not m.get("one_time") else 0.0


# ───────────────────────── metrics ─────────────────────────
@router.get("/overview")
async def overview(request: Request, range: int = Query(30, ge=1, le=365), currency: str = Query("usd")):
    await require_admin(request)
    cur = "inr" if currency == "inr" else "usd"
    C = await _customers()
    signups = sum(_within(c["created_at"], range) for c in C)
    prev = sum(_within(c["created_at"], range, range) for c in C)
    active = lambda d: sum(_within(c["last_active_at"], d) for c in C if c["status"] != "suspended")  # noqa: E731
    paying = [c for c in C if c["status"] == "paying"]
    cohort = [c for c in C if _within(c["created_at"], range, 14)]
    converted = [c for c in cohort if c["paid_since"]]
    canceled30 = sum(_within(c["canceled_at"], 30) for c in C)
    monthly = sum(1 for c in C if c["plan"] == "monthly" and c["status"] in ("paying", "past_due"))
    past_due = [c for c in C if c["status"] == "past_due"]
    sb_opened = await db.sandbox_events.count_documents({"type": "start", "at": {"$gte": _iso(_now() - timedelta(days=range))}})
    sb_tour = await db.sandbox_events.count_documents({"type": "tour_step", "step": 5, "at": {"$gte": _iso(_now() - timedelta(days=range))}})
    n_days = min(range, 90)
    series = []
    for i in range_(n_days):
        day = n_days - 1 - i
        start = _now() - timedelta(days=day + 1)
        series.append({"date": (_now() - timedelta(days=day)).date().isoformat(),
                       "signups": sum(1 for c in C if start <= (_dt(c["created_at"]) or start) < start + timedelta(days=1))})
    with_src = [c for c in C if c["sources"]]
    latest = sorted(C, key=lambda c: c["created_at"], reverse=True)[:5]
    reviews = await _review_stats()
    return {
        "range": range, "currency": cur, "updated_at": _iso(_now()),
        "kpis": {
            "signups": {"value": signups, "delta_pct": _delta(signups, prev)},
            "active_users": {"dau": active(1), "wau": active(7), "mau": active(30)},
            "mrr": {"value": round(sum(_mrr(c, cur) for c in C), 2), "currency": cur,
                    "new": round(sum(_mrr(c, cur) for c in C if _within(c["paid_since"], range)), 2),
                    "inr_value": round(sum(_mrr(c, "inr") for c in C if c["currency"] == "inr"))},
            "trial_to_paid": {"pct": _pct(len(converted), len(cohort)), "converted": len(converted), "trials": len(cohort)},
            "paying": {"value": len(paying), "monthly": sum(1 for c in paying if c["plan"] == "monthly"), "project": sum(1 for c in paying if c["plan"] == "project")},
            "churn": {"pct": _pct(canceled30, monthly + canceled30), "canceled": canceled30},
            "workspaces": {"active": sum(c["projects"] for c in C if _within(c["last_active_at"], 30) and c["status"] != "expired"),
                           "created": await db.projects.count_documents({"is_demo": {"$ne": True}})},
            "failed_payments": {"value": len(past_due), "at_risk": round(sum(_fx(PRICE["monthly"][c["currency"]], c["currency"], cur) for c in past_due), 2), "currency": cur},
        },
        "signups_series": series,
        "funnel": [
            {"key": "sandbox", "label": "Sandbox opened", "value": sb_opened},
            {"key": "tour", "label": "Finished the tour", "value": sb_tour},
            {"key": "signup", "label": "Signed up", "value": signups},
            {"key": "trial", "label": "Started a trial", "value": sum(1 for c in C if _within(c["created_at"], range) and c["projects"])},
            {"key": "paid", "label": "Became paying", "value": sum(_within(c["paid_since"], range) for c in C)},
        ],
        "sources": [{"provider": p, "count": sum(1 for c in with_src if p in c["sources"])} for p in PROVIDERS],
        "health": {"sync_failures": sum(1 for c in C if c["sync_error"]), "review_acceptance_pct": reviews["pct"],
                   "asks_per_day": reviews["asks_per_day"], "high_confidence_pct": reviews["high_conf_pct"], "replies_per_day": reviews["replies_per_day"]},
        "latest": [_public(c) for c in latest],
    }


range_ = range  # `range` is shadowed by the query parameter name inside handlers


async def _review_stats() -> dict:
    """Acceptance rate from memory statuses; ask/reply volume from source events."""
    since = _iso(_now() - timedelta(days=30))
    accepted = await db.project_memory.count_documents({"status": {"$in": ["confirmed", "current"]}, "updated_at": {"$gte": since}})
    dismissed = await db.project_memory.count_documents({"status": {"$in": ["ignored", "not_a_change", "dismissed"]}, "updated_at": {"$gte": since}})
    asks = await db.source_events.count_documents({"kind": "ask", "at": {"$gte": since}})
    replies = await db.source_events.count_documents({"kind": {"$in": ["email_sent", "reply_sent"]}, "at": {"$gte": since}})
    return {"pct": _pct(accepted, accepted + dismissed), "reviewed": accepted + dismissed, "asks_per_day": round(asks / 30),
            "replies_per_day": round(replies / 30), "high_conf_pct": 0}


@router.get("/users")
async def users(request: Request, q: str = "", status: str = "all", sort: str = "last_active",
                page: int = Query(1, ge=1), size: int = Query(25, ge=5, le=100), export: int = 0):
    await require_admin(request)
    C = await _customers()
    counts = {k: 0 for k in ("all", "trial", "paying", "past_due", "canceled", "expired", "suspended")}
    for c in C:
        counts["all"] += 1
        counts[c["status"]] = counts.get(c["status"], 0) + 1
    s = q.strip().lower()
    rows = [c for c in C if (status in ("", "all") or c["status"] == status)
            and (not s or s in c["name"].lower() or s in c["email"].lower() or s in c["company"].lower())]
    keys = {"signed_up": (lambda c: c["created_at"] or "", True), "projects": (lambda c: c["projects"], True),
            "name": (lambda c: c["name"].lower(), False), "last_active": (lambda c: c["last_active_at"] or "", True)}
    fn, rev = keys.get(sort, keys["last_active"])
    rows.sort(key=fn, reverse=rev)
    if export:
        page, size = 1, 5000
    return {"total": len(rows), "page": page, "size": size, "counts": counts,
            "users": [_public(c) for c in rows[(page - 1) * size: page * size]]}


@router.get("/users/{uid}")
async def user_detail(uid: str, request: Request):
    await require_admin(request)
    u = await db.users.find_one({"user_id": uid}, _USER_FIELDS)
    if not u:
        raise HTTPException(404, "No user with that ID.")
    projects = await db.projects.find({"owner_user_id": uid, "is_demo": {"$ne": True}, "archived": {"$ne": True}},
                                      {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(length=200)
    conns = await db.source_connections.find({"user_id": uid, "is_demo": {"$ne": True}},
                                             {"_id": 0, "project_id": 1, "provider": 1, "source_name": 1, "status": 1, "last_synced_at": 1, "updated_at": 1, "error": 1}).to_list(length=500)
    sources = sorted({c.get("provider") for c in conns if c.get("provider")})
    err = next((c.get("provider") for c in conns if c.get("status") in ("error", "expired", "revoked")), None)
    c = _customer(u, len(projects), sources, err)
    ws = []
    for p in projects:
        mem = await db.project_memory.count_documents({"project_id": p["id"]})
        att = await db.project_memory.count_documents({"project_id": p["id"], "status": {"$in": ["detected", "review"]}})
        ws.append({"id": p["id"], "name": p.get("name") or "Untitled", "client": p.get("client_name") or "",
                   "sources": sorted({x.get("provider") for x in conns if x.get("project_id") == p["id"]}), "memories": mem, "attention": att})
    activity = []
    for i in range_(30):
        day = (_now() - timedelta(days=29 - i)).date().isoformat()
        activity.append({"date": day, "sessions": await db.sessions.count_documents({"user_id": uid, "day": day})})
    reviewed = await db.project_memory.count_documents({"owner_user_id": uid, "status": {"$in": ["confirmed", "current", "ignored", "not_a_change"]}})
    accepted = await db.project_memory.count_documents({"owner_user_id": uid, "status": {"$in": ["confirmed", "current"]}})
    actions = await db.admin_audit.find({"detail.user_id": uid}, {"_id": 0}).sort("at", -1).to_list(length=10)
    paying = c["status"] in ("paying", "past_due")
    return {
        **_public(c), "country": u.get("country") or "", "currency": c["currency"], "sign_in": "password" if await db.users.count_documents({"user_id": uid, "password_hash": {"$nin": ["", None]}}) else "google",
        "email_verified": bool(u.get("email_verified", True)), "suspended": bool(u.get("suspended")), "suspended_reason": u.get("suspended_reason"),
        "trial_ends_at": c["trial_ends_at"], "paid_since": c["paid_since"], "canceled_at": c["canceled_at"],
        "billing": {"status": c["status"], "plan_label": c["plan_label"], "currency": c["currency"],
                    "payment_method": u.get("card") if paying else None,
                    "invoices": await db.payment_transactions.count_documents({"user_id": uid, "payment_status": "paid"}),
                    "lifetime_value": sum([t.get("amount") or 0 async for t in db.payment_transactions.find({"user_id": uid, "payment_status": "paid"}, {"amount": 1})]),
                    "retry": u.get("retry")},
        "workspaces": ws,
        "sources": [{"provider": x.get("provider"), "label": x.get("source_name") or "", "status": "error" if x.get("status") in ("error", "expired", "revoked") else "synced",
                     "error": x.get("error"), "since": x.get("last_synced_at") or x.get("updated_at")} for x in conns],
        "activity": activity,
        "usage": {"sessions": sum(a["sessions"] for a in activity), "reviewed": reviewed, "accepted": accepted, "asks": 0, "replies": 0},
        "account": {"members_invited": 0, "last_device": (u.get("last_user_agent") or u.get("signup_user_agent") or "")[:60], "last_city": u.get("city") or ""},
        "actions": actions,
    }


class ExtendIn(BaseModel):
    days: int
    reason: str = Field("", max_length=500)
    notify: bool = True


@router.post("/users/{uid}/extend-trial")
async def extend_trial(uid: str, body: ExtendIn, request: Request):
    await require_admin(request)
    u = await db.users.find_one({"user_id": uid}, _USER_FIELDS)
    if not u:
        raise HTTPException(404, "No user with that ID.")
    c = _customer(u, 0, [], None)
    if c["status"] not in ("trial", "expired") or c["paid_since"]:
        raise HTTPException(409, "Only accounts on a trial, or whose trial ended, can be extended.")
    if body.days not in (7, 14):
        raise HTTPException(422, "Choose 7 or 14 days.")
    if not body.reason.strip():
        raise HTTPException(422, "Add a reason for the audit log.")
    base = max(_now(), _dt(c["trial_ends_at"]) or _now())
    ends = base + timedelta(days=body.days)
    await db.users.update_one({"user_id": uid}, {"$set": {"trial_ends_at": _iso(ends), "updated_at": _iso(_now())}})
    await _audit("extend_trial", _ip(request), {"user_id": uid, "days": body.days, "reason": body.reason.strip(), "notified": body.notify})
    if body.notify and u.get("email"):
        try:
            from emailer import send_trial_extended  # optional template
            await send_trial_extended(u["email"], u.get("name", ""), _iso(ends))
        except Exception:
            logger.info("trial-extended email not sent (template unavailable)")
    return {"ok": True, "trial_ends_at": _iso(ends), "notified": body.notify}


class ReasonIn(BaseModel):
    reason: str = Field("", max_length=500)


@router.post("/users/{uid}/suspend")
async def suspend(uid: str, body: ReasonIn, request: Request):
    await require_admin(request)
    if not body.reason.strip():
        raise HTTPException(422, "Add a reason for the audit log.")
    res = await db.users.update_one({"user_id": uid}, {"$set": {"suspended": True, "suspended_reason": body.reason.strip(), "suspended_at": _iso(_now())}})
    if not res.matched_count:
        raise HTTPException(404, "No user with that ID.")
    await db.user_sessions.delete_many({"user_id": uid})  # signed out everywhere
    await _audit("suspend", _ip(request), {"user_id": uid, "reason": body.reason.strip()})
    return {"ok": True}


@router.post("/users/{uid}/unsuspend")
async def unsuspend(uid: str, request: Request):
    await require_admin(request)
    res = await db.users.update_one({"user_id": uid}, {"$set": {"suspended": False}, "$unset": {"suspended_reason": "", "suspended_at": ""}})
    if not res.matched_count:
        raise HTTPException(404, "No user with that ID.")
    await _audit("unsuspend", _ip(request), {"user_id": uid})
    return {"ok": True}


@router.get("/revenue")
async def revenue(request: Request, range: int = Query(30, ge=1, le=365), currency: str = Query("usd")):
    await require_admin(request)
    cur = "inr" if currency == "inr" else "usd"
    C = await _customers()
    monthly_c = [c for c in C if c["plan"] == "monthly"]

    def mrr_at(t: datetime) -> Dict[str, float]:
        out = {"usd": 0.0, "inr": 0.0}
        for c in monthly_c:
            since, canceled = _dt(c["paid_since"]), _dt(c["canceled_at"])
            if since and since <= t and (not canceled or canceled > t):
                out[c["currency"]] += _fx(PRICE["monthly"][c["currency"]], c["currency"], cur)
        return out

    months = []
    for i in range_(12):
        y, m = _now().year, _now().month - (11 - i)
        while m <= 0:
            m += 12
            y -= 1
        nxt = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
        t = min(_now(), nxt - timedelta(seconds=1))
        v = mrr_at(t)
        months.append({"month": t.strftime("%b"), "usd": round(v["usd"], 2), "inr": round(v["inr"], 2)})
    now_v, prev_v = mrr_at(_now()), mrr_at(_now() - timedelta(days=range))
    live = [c for c in monthly_c if c["status"] in ("paying", "past_due")]
    projects = [c for c in C if c["plan"] == "project" and _within(c["paid_since"], range)]
    mrr = now_v["usd"] + now_v["inr"]
    tenure = [((_dt(c["canceled_at"]) or _now()) - _dt(c["paid_since"])).days / 30 for c in monthly_c if c["paid_since"]]
    by = lambda rows, cu: [c for c in rows if c["currency"] == cu]  # noqa: E731
    return {
        "range": range, "currency": cur,
        "kpis": {"mrr": {"value": round(mrr, 2), "net_new": round(mrr - prev_v["usd"] - prev_v["inr"], 2)},
                 "inr": {"value": len(by(live, "inr")) * PRICE["monthly"]["inr"]},
                 "arpa": {"value": round(mrr / len(live), 2) if live else 0},
                 "per_project": {"count": len(projects), "amount": round(sum(_fx(PRICE["project"][c["currency"]], c["currency"], cur) for c in projects), 2)}},
        "months": months,
        "mix": [
            {"key": "monthly_usd", "label": "Monthly · USD", "count": len(by(live, "usd")), "amount": len(by(live, "usd")) * 12, "currency": "usd"},
            {"key": "monthly_inr", "label": "Monthly · INR", "count": len(by(live, "inr")), "amount": len(by(live, "inr")) * 999, "currency": "inr"},
            {"key": "project_usd", "label": "Per project · USD", "count": len(by(projects, "usd")), "amount": len(by(projects, "usd")) * 2, "currency": "usd"},
            {"key": "project_inr", "label": "Per project · INR", "count": len(by(projects, "inr")), "amount": len(by(projects, "inr")) * 199, "currency": "inr"},
        ],
        "avg_tenure_months": round(sum(tenure) / len(tenure), 1) if tenure else 0,
        "failed_payments": [{"user_id": c["id"], "name": c["name"], "amount": PRICE["monthly"][c["currency"]], "currency": c["currency"],
                             "attempt": int((c["_u"].get("retry") or {}).get("attempt") or 1), "of": 3,
                             "next_retry_at": (c["_u"].get("retry") or {}).get("next_at"), "grace_ends_at": (c["_u"].get("retry") or {}).get("grace_ends_at")}
                            for c in C if c["status"] == "past_due"],
    }


@router.get("/usage")
async def usage(request: Request, range: int = Query(30, ge=1, le=365)):
    await require_admin(request)
    C = await _customers()
    with_src = [c for c in C if c["sources"]]
    weekly = [c for c in C if _within(c["last_active_at"], 7)]
    reviews = await _review_stats()
    fails = await db.source_connections.aggregate([
        {"$match": {"is_demo": {"$ne": True}, "status": {"$in": ["error", "expired", "revoked"]}}},
        {"$group": {"_id": {"provider": "$provider", "error": "$error"}, "n": {"$sum": 1}, "since": {"$min": "$updated_at"}}},
        {"$sort": {"n": -1}}, {"$limit": 20}]).to_list(length=20)
    return {
        "range": range,
        "kpis": {"review_acceptance": {"pct": reviews["pct"], "reviewed": reviews["reviewed"]},
                 "asks": {"per_day": reviews["asks_per_day"], "high_confidence_pct": reviews["high_conf_pct"]},
                 "replies": {"per_day": reviews["replies_per_day"]},
                 "sync_failures": {"value": sum(f["n"] for f in fails)}},
        "sources": [{"provider": p, "count": sum(1 for c in with_src if p in c["sources"]),
                     "pct": _pct(sum(1 for c in with_src if p in c["sources"]), len(with_src))} for p in PROVIDERS],
        "features": [
            {"key": "review", "label": "Change review", "pct": _pct(sum(1 for c in weekly if c["projects"]), len(weekly))},
            {"key": "ask", "label": "Ask Bracket", "pct": 0}, {"key": "replies", "label": "Draft replies", "pct": 0},
            {"key": "restore", "label": "Timeline restore", "pct": 0}, {"key": "invite", "label": "Invite members", "pct": 0},
        ],
        "sync_failures": [{"provider": f["_id"].get("provider"), "error": f["_id"].get("error") or "Sync error", "workspaces": f["n"], "since": f.get("since")} for f in fails],
    }


@router.get("/sandbox")
async def sandbox(request: Request, range: int = Query(30, ge=1, le=365)):
    await require_admin(request)
    since = _iso(_now() - timedelta(days=range))
    prev_since = _iso(_now() - timedelta(days=2 * range))
    count = lambda q: db.sandbox_events.count_documents({**q, "at": {"$gte": since}})  # noqa: E731
    sessions = await count({"type": "start"})
    prev = await db.sandbox_events.count_documents({"type": "start", "at": {"$gte": prev_since, "$lt": since}})
    steps = [await count({"type": "tour_step", "step": n}) for n in (1, 2, 3, 4, 5)]
    steps[0] = max(steps[0], sessions)
    signups = await db.users.count_documents({"from_sandbox": True, "created_at": {"$gte": since}})
    durations = [d["seconds"] async for d in db.sandbox_events.find({"type": "leave", "at": {"$gte": since}, "seconds": {"$gt": 0}}, {"seconds": 1})]
    durations.sort()
    locked_labels = [("connect", "Connect Gmail or Slack"), ("note", "Add a note"), ("invite", "Invite a member"), ("upload", "Upload a file"), ("send", "Send a reply")]
    actions = [("play", "Played a client message"), ("accept", "Accepted a change"), ("ask", "Asked a question"), ("source", "Opened a source"), ("reset", "Reset the sandbox")]
    acts = []
    for k, label in actions:
        n = await count({"type": "action", "action": k})
        users_n = len(await db.sandbox_events.distinct("sandbox_id", {"type": "action", "action": k, "at": {"$gte": since}}))
        acts.append({"key": k, "label": label, "per_session": round(n / sessions, 1) if sessions else 0, "pct": round(_pct(users_n, sessions))})
    return {
        "range": range,
        "kpis": {"sessions": {"value": sessions, "delta_pct": _delta(sessions, prev)},
                 "finished_tour": {"pct": _pct(steps[4], sessions), "count": steps[4]},
                 "to_signup": {"pct": _pct(signups, sessions), "count": signups},
                 "median_time_s": durations[len(durations) // 2] if durations else 0},
        "steps": [{"step": i + 1, "label": l, "count": steps[i]} for i, l in enumerate(["Needs your attention", "Review a change", "Ask Bracket", "Play a client message", "What you pay for"])],
        "locked": [{"action": k, "label": l, "count": await count({"type": "locked", "action": k})} for k, l in locked_labels],
        "actions": acts,
        "live": {"sessions": sessions, "events": await count({})},
    }


@router.get("/audit")
async def audit(request: Request):
    await require_admin(request)
    return {"items": await db.admin_audit.find({}, {"_id": 0}).sort("at", -1).to_list(length=100)}


async def ensure_indexes() -> None:
    try:
        await db.admin_sessions.create_index("token_hash", unique=True)
        await db.admin_sessions.create_index("expires_at")
        await db.admin_login_attempts.create_index("ip", unique=True)
        await db.admin_audit.create_index([("at", -1)])
        await db.sandbox_events.create_index([("type", 1), ("at", -1)])
    except Exception:
        logger.exception("admin index creation failed")


def install(app) -> None:
    """Mount the router, the 401 handler and the indexes on the FastAPI app."""
    async def _session_error(request: Request, exc: AdminSessionError):
        return _err(401, "Your admin session ended. Sign in again.", code="admin_session")

    app.add_exception_handler(AdminSessionError, _session_error)
    app.include_router(router)
    app.add_event_handler("startup", ensure_indexes)
