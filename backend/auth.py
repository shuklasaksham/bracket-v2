"""Auth helpers for Bracket — Emergent Google + Email OTP + optional password.

Single source of truth: a `session_token` cookie issued either after Google OAuth,
after OTP verification, or after email/password login. All paths land in the same
`user_sessions` collection so the rest of the app has one auth contract.

REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
THIS BREAKS THE EMERGENT GOOGLE AUTH FLOW.
"""
from __future__ import annotations

import os
import secrets
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

import httpx
import resend
from fastapi import Request, HTTPException, Response
from passlib.hash import bcrypt as _bcrypt

logger = logging.getLogger("bracket.auth")

SESSION_COOKIE = "session_token"
SESSION_TTL_DAYS = 7
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 30

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


# ---------- ids + helpers ----------
def gen_user_id() -> str:
    return f"user_{secrets.token_hex(6)}"


def gen_session_token() -> str:
    return f"st_{secrets.token_urlsafe(28)}"


def gen_otp() -> str:
    # 6-digit zero-padded numeric code
    return f"{secrets.randbelow(1_000_000):06d}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def aware(dt: Any) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return None
    if isinstance(dt, datetime) and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def hash_password(plain: str) -> str:
    return _bcrypt.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.verify(plain, hashed)
    except Exception:
        return False


# ---------- session cookie ----------
def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="none", secure=True)


# ---------- session store ----------
async def create_session(db, user_id: str) -> str:
    token = gen_session_token()
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": iso(now_utc() + timedelta(days=SESSION_TTL_DAYS)),
        "created_at": iso(now_utc()),
    })
    return token


async def get_session(db, token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    s = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not s:
        return None
    expires = aware(s.get("expires_at"))
    if not expires or expires < now_utc():
        return None
    return s


async def delete_session(db, token: str) -> None:
    if token:
        await db.user_sessions.delete_one({"session_token": token})


# ---------- current user dependency ----------
def _bearer_from_header(request: Request) -> Optional[str]:
    auth_h = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_h and auth_h.lower().startswith("bearer "):
        return auth_h.split(" ", 1)[1].strip()
    return None


async def current_user_optional(request: Request, db) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE) or _bearer_from_header(request)
    session = await get_session(db, token)
    if not session:
        return None
    # NOTE: we keep password_hash in the doc here so public_user() can compute
    # the has_password flag correctly. public_user() strips it before returning.
    user = await db.users.find_one(
        {"user_id": session["user_id"]},
        {"_id": 0},
    )
    if not user:
        return None
    if user.get("suspended"):  # suspended from the admin panel — signed out everywhere
        return None
    return user


async def current_user(request: Request, db) -> Dict[str, Any]:
    user = await current_user_optional(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    # Best-effort last_seen tracking (used for admin engagement cohorts).
    # Silent on failure — we never want auth to hinge on analytics writes.
    try:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"last_seen_at": iso(now_utc())}},
        )
    except Exception:
        pass
    return user


# ---------- admin guard ----------
def admin_emails() -> set[str]:
    """Effective admin allowlist (comma-separated, lowercased).

    Prefers ADMIN_EMAILS_OVERRIDE — a *fresh* env key used to correct a frozen
    production ADMIN_EMAILS secret (redeploys never overwrite existing secret
    values, but new keys DO propagate). Falls back to ADMIN_EMAILS. Any email in
    PURGE_USER_EMAILS is always removed — a decommissioned account can never be
    an admin."""
    raw = (os.environ.get("ADMIN_EMAILS_OVERRIDE", "").strip()
           or os.environ.get("ADMIN_EMAILS", ""))
    emails = {e.strip().lower() for e in raw.split(",") if e.strip()}
    purge = {e.strip().lower() for e in os.environ.get("PURGE_USER_EMAILS", "").split(",") if e.strip()}
    return emails - purge


def is_admin(user: Dict[str, Any]) -> bool:
    return (user.get("email") or "").lower() in admin_emails()


async def current_admin(request: Request, db) -> Dict[str, Any]:
    """Admin guard. ANY failure (no session, non-admin) returns 404 so the
    existence of the admin surface is never revealed to end users."""
    try:
        user = await current_user(request, db)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Not found")
    # NOTE: `user` is guaranteed assigned here — the except branch raises
    # and exits before this point. Static analyzers can't model `raise`.
    if not is_admin(user):  # noqa: F821
        raise HTTPException(status_code=404, detail="Not found")
    return user  # noqa: F821


# ---------- users ----------
def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Strip sensitive fields and add has_password / is_admin / is_guest flags."""
    out = {k: v for k, v in user.items() if k not in ("password_hash", "_id")}
    out["has_password"] = bool(user.get("password_hash"))
    out["is_admin"] = is_admin(user)
    out["is_guest"] = bool(user.get("is_guest"))
    out["can_test_plan"] = can_use_test_plan(user)
    out["can_ph_launch"] = can_use_ph_launch(user)
    return out


def _test_plan_emails() -> set:
    raw = os.environ.get("TEST_PLAN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


# Runtime toggle for the TEMPORARY ₹0 test plan, flipped from the admin panel.
# Loaded from the app_settings collection at startup and mutated on toggle.
TEST_PLAN_STATE = {"enabled": False}

# Runtime toggle for the Product Hunt launch offer (first project free 14 days).
PH_LAUNCH_STATE = {"enabled": False}


def can_use_ph_launch(user: Dict[str, Any]) -> bool:
    """Product Hunt launch offer — first project free for 14 days, no card.
    Available to any signed-in account that hasn't already claimed it or bought a
    plan, while the admin toggle is ON."""
    if not PH_LAUNCH_STATE.get("enabled"):
        return False
    if user.get("ph_claimed"):
        return False
    if user.get("plan") in ("monthly", "project", "ph_launch"):
        return False
    return True


def can_use_test_plan(user: Dict[str, Any]) -> bool:
    """TEMPORARY free ₹0 test plan gate. Admins can always test; when the global
    admin toggle is ON, every signed-in user can. An env allowlist still works."""
    if is_admin(user):
        return True
    if TEST_PLAN_STATE.get("enabled"):
        return True
    email = (user.get("email") or "").lower().strip()
    return bool(email) and email in _test_plan_emails()


async def get_or_create_user_by_email(
    db,
    email: str,
    *,
    name: Optional[str] = None,
    avatar: Optional[str] = None,
    designation: Optional[str] = None,
    picture: Optional[str] = None,
    signup_ip: Optional[str] = None,
    signup_user_agent: Optional[str] = None,
) -> Dict[str, Any]:
    email = email.lower().strip()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        # Soft-update name/picture if we just got better data from Google.
        update: Dict[str, Any] = {"updated_at": iso(now_utc())}
        if picture and not existing.get("picture"):
            update["picture"] = picture
        if name and not existing.get("name"):
            update["name"] = name
        # Backfill signup meta ONCE (never overwrite the first-observed values).
        if signup_ip and not existing.get("signup_ip"):
            update["signup_ip"] = signup_ip[:64]
        if signup_user_agent and not existing.get("signup_user_agent"):
            update["signup_user_agent"] = signup_user_agent[:400]
        await db.users.update_one({"user_id": existing["user_id"]}, {"$set": update})
        existing.update(update)
        return existing

    user_id = gen_user_id()
    doc = {
        "user_id": user_id,
        "email": email,
        "name": (name or "").strip(),
        "designation": (designation or "").strip(),
        "avatar": avatar or "mono-1",  # default brutalist avatar
        "picture": picture or "",
        "password_hash": "",
        "signup_ip": (signup_ip or "")[:64],
        "signup_user_agent": (signup_user_agent or "")[:400],
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- google session exchange ----------
async def exchange_emergent_session(session_id: str) -> Dict[str, Any]:
    """Call Emergent's session endpoint with the X-Session-ID from the URL fragment.
    Returns the {id,email,name,picture,session_token} envelope."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Google sign-in failed. Try again.")
    data = r.json()
    if not data.get("email"):
        raise HTTPException(status_code=401, detail="Google session missing email.")
    return data


# ---------- OTP ----------
async def store_otp(db, email: str, code: str) -> None:
    email = email.lower().strip()
    await db.email_otps.update_one(
        {"email": email},
        {
            "$set": {
                "email": email,
                "code_hash": hash_password(code),
                "expires_at": iso(now_utc() + timedelta(minutes=OTP_TTL_MINUTES)),
                "attempts": 0,
                "issued_at": iso(now_utc()),
            }
        },
        upsert=True,
    )


async def verify_otp(db, email: str, code: str) -> bool:
    email = email.lower().strip()
    rec = await db.email_otps.find_one({"email": email}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="Request a code first.")
    expires = aware(rec.get("expires_at"))
    if not expires or expires < now_utc():
        await db.email_otps.delete_one({"email": email})
        raise HTTPException(status_code=400, detail="Code expired. Send a new one.")
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.email_otps.delete_one({"email": email})
        raise HTTPException(status_code=429, detail="Too many wrong tries. Send a new code.")
    if not verify_password(code, rec.get("code_hash", "")):
        await db.email_otps.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Wrong code. Check the email again.")
    # success — burn the code
    await db.email_otps.delete_one({"email": email})
    return True


def _otp_html(name: str, code: str) -> str:
    display = (name or "there").strip() or "there"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Your Bracket sign-in code</title>
</head>
<body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your Bracket sign-in code — expires in 10 minutes. Do not share this code with anyone.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table role="presentation" width="480" style="max-width:480px;background:#0F1114;border-radius:16px;border:1px solid #26282D;">
<tr><td style="padding:32px 36px 0 36px;">
<p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">&lt; bracket &middot; sign in &gt;</p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
<p style="margin:0 0 4px 0;font-size:13.5px;color:#6E7480;">Hi {display},</p>
<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">Here is your sign-in code.</h1>
</td></tr>
<tr><td style="padding:14px 36px 0 36px;">
<p style="margin:0;font-size:14.5px;line-height:1.65;color:#B9BFC9;">Enter the code below in Bracket to finish signing in. It expires in 10 minutes.</p>
</td></tr>
<tr><td style="padding:20px 36px 0 36px;">
<div style="display:inline-block;background:#16181D;color:#F4F5F7;padding:16px 26px;font-family:'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace;font-size:26px;letter-spacing:8px;font-weight:600;border-radius:12px;border:1px solid #2A2D34;">{code}</div>
</td></tr>
<tr><td style="padding:22px 36px 30px 36px;">
<p style="margin:0 0 6px 0;font-size:12.5px;line-height:1.55;color:#6E7480;">If you didn't try to sign in, you can safely ignore this email — no one will be able to access your account without the code.</p>
<p style="margin:16px 0 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:16px;">Bracket &middot; The AI decision workspace for client projects</p>
<p style="margin:8px 0 0 0;font-size:12px;color:#6E7480;"><a href="https://use-bracket.com" style="color:#5E6AD2;text-decoration:none;">use-bracket.com</a></p>
</td></tr>
</table>
<p style="margin:16px 0 0 0;font-size:11.5px;color:#4B5058;">Sent by Bracket · support@use-bracket.com</p>
</td></tr>
</table>
</body></html>"""


def _otp_text(name: str, code: str) -> str:
    display = (name or "there").strip() or "there"
    return (
        f"Hi {display},\n\n"
        f"Here is your Bracket sign-in code:\n\n"
        f"    {code}\n\n"
        "Enter this in Bracket to finish signing in. The code expires in 10 minutes.\n\n"
        "If you didn't try to sign in, you can safely ignore this email — no one will be able "
        "to access your account without the code.\n\n"
        "— The Bracket team\n"
        "https://use-bracket.com\n"
    )


async def send_otp_email(to_email: str, name: str, code: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning(f"[OTP DEV] {to_email} -> {code}")  # dev fallback
        return False
    resend.api_key = api_key
    sender_email = os.environ.get("SENDER_EMAIL", "").strip()
    sender_name = os.environ.get("SENDER_NAME", "Bracket").strip() or "Bracket"
    sender = f"{sender_name} <{sender_email}>" if sender_email else "Bracket <onboarding@resend.dev>"
    params = {
        "from": sender,
        "to": [to_email],
        # No code in the subject — code-in-subject is a well-known spam signal
        # and phishing pattern. Keep it human and neutral.
        "subject": "Your Bracket sign-in code",
        "html": _otp_html(name, code),
        "text": _otp_text(name, code),
        "headers": {
            # Transactional / one-off — helps deliverability filters classify.
            "X-Entity-Ref-ID": f"bracket-otp-{code}",
            # Give recipient a compliant unsubscribe option (even though this
            # is transactional). Reduces the odds Gmail/Outlook flag it.
            "List-Unsubscribe": f"<mailto:{sender_email or 'support@use-bracket.com'}?subject=unsubscribe>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        "tags": [
            {"name": "category", "value": "auth"},
            {"name": "type", "value": "otp"},
        ],
    }
    if sender_email:
        params["reply_to"] = sender_email  # omit key entirely when empty
    try:
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:
        logger.exception(f"OTP email failed for {to_email}: {e}")
        # Don't reveal failure to client — they can retry. Print to log for ops.
        logger.warning(f"[OTP FALLBACK] {to_email} -> {code}")
        return False
