"""Connect Work — source connections layer.

ONE PROJECT → MANY SOURCE CONNECTIONS. One-click OAuth for end users
(Figma / Gmail / Slack / GitHub / Notion) — provider OAuth app credentials
are an ADMIN concern configured via backend env vars, never exposed to
users. Providers without configured credentials show "setup_required".

Privacy boundary: even when OAuth grants broader account access, Bracket
only ingests/stores/processes the specific sources the user selects.
"""
import asyncio
import base64
import hashlib
import json as _json
from email.message import EmailMessage
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, File, Form, UploadFile
from fastapi.responses import HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from auth import current_user
from connect_ai import analyze_connected_source, answer_project_question, detect_source_updates, extract_from_notes, suggest_reply_for_change, suggest_project_reply, build_project_update
from emailer import send_scope_digest

logger = logging.getLogger("bracket")
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]

_fernet = Fernet(os.environ["CONNECT_TOKEN_KEY"].encode())

router = APIRouter(prefix="/api")

PUBLIC_BASE = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


def _enc(s: str) -> str:
    return _fernet.encrypt(s.encode()).decode()


def _dec(s: str) -> str:
    return _fernet.decrypt(s.encode()).decode()


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="replace")).hexdigest()


# ---------------------------------------------------------------------------
# OAuth app credentials (admin-side, from env). A provider is "configured"
# when both its client id + secret exist.
# ---------------------------------------------------------------------------
OAUTH_CONF: Dict[str, Dict[str, str]] = {
    "figma":  {"id": os.environ.get("FIGMA_CLIENT_ID", ""),  "secret": os.environ.get("FIGMA_CLIENT_SECRET", "")},
    "gmail":  {"id": os.environ.get("GOOGLE_OAUTH_CLIENT_ID", ""), "secret": os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")},
    "slack":  {"id": os.environ.get("SLACK_CLIENT_ID", ""),  "secret": os.environ.get("SLACK_CLIENT_SECRET", "")},
    "github": {"id": os.environ.get("GITHUB_CLIENT_ID", ""), "secret": os.environ.get("GITHUB_CLIENT_SECRET", "")},
    "notion": {"id": os.environ.get("NOTION_CLIENT_ID", ""), "secret": os.environ.get("NOTION_CLIENT_SECRET", "")},
}


def _configured(provider: str) -> bool:
    c = OAUTH_CONF.get(provider) or {}
    return bool(c.get("id") and c.get("secret"))


def _redirect_uri(provider: str, request: Optional[Request] = None) -> str:
    """Derive from the requesting host so OAuth works on preview AND production
    (both callback URLs must be registered in the provider's OAuth app)."""
    base = PUBLIC_BASE
    if request is not None:
        host = request.headers.get("x-forwarded-host") or ""
        if not host:
            host = request.headers.get("host") or ""
        if host and "cluster" not in host and "localhost" not in host:
            proto = request.headers.get("x-forwarded-proto", "https")
            base = f"{proto}://{host}"
    return f"{base}/api/connect/{provider}/callback"


PROVIDERS: Dict[str, Dict[str, Any]] = {
    "gmail":    {"label": "Gmail", "category": "Communication", "desc": "Connect a specific email conversation", "impl": "oauth",
                 "select_mode": "list", "select_hint": "Choose the email conversation you want Bracket to understand.", "multi": True},
    "slack":    {"label": "Slack", "category": "Communication", "desc": "Connect a specific channel, conversation or thread", "impl": "oauth",
                 "select_mode": "list", "select_hint": "Choose the channel or conversation Bracket should understand.", "multi": True},
    "whatsapp": {"label": "WhatsApp", "category": "Communication", "desc": "Connect a supported client conversation", "impl": "soon"},
    "teams":    {"label": "Microsoft Teams", "category": "Communication", "desc": "Connect a specific conversation", "impl": "soon"},
    "figma":    {"label": "Figma", "category": "Design", "desc": "Connect a specific design file", "impl": "oauth",
                 "select_mode": "figma", "select_hint": "Pick files from your team, or paste a file link.", "multi": True},
    "adobe":    {"label": "Adobe", "category": "Design", "desc": "Connect a specific design/project source", "impl": "soon"},
    "gdrive":   {"label": "Google Drive", "category": "Files & Knowledge", "desc": "Connect a specific file or folder", "impl": "soon"},
    "notion":   {"label": "Notion", "category": "Files & Knowledge", "desc": "Connect a specific page or workspace source", "impl": "oauth",
                 "select_mode": "list", "select_hint": "Pages you granted Bracket access to during authorization.", "multi": True},
    "dropbox":  {"label": "Dropbox", "category": "Files & Knowledge", "desc": "Connect a specific file or folder", "impl": "soon"},
    "github":   {"label": "GitHub", "category": "Development", "desc": "Connect a repository, issue or project", "impl": "oauth",
                 "select_mode": "list", "select_hint": "Your most recently active repositories.", "multi": True},
    "linear":   {"label": "Linear", "category": "Development", "desc": "Connect a project or issue", "impl": "soon"},
}

CATEGORY_ORDER = ["Communication", "Design", "Files & Knowledge", "Development"]


# ---------------------------------------------------------------------------
# Account token helpers — token_enc always stores a JSON blob:
#   {"access_token", "refresh_token"?, "expires_at"?}
# Legacy PAT accounts (raw string) are still readable.
# ---------------------------------------------------------------------------
def _read_blob(account: dict) -> dict:
    raw = _dec(account["token_enc"])
    try:
        blob = _json.loads(raw)
        if isinstance(blob, dict) and blob.get("access_token"):
            return blob
    except Exception:
        pass
    return {"access_token": raw}


async def _store_blob(user_id: str, provider: str, blob: dict, label: str):
    now = _now_iso()
    await db.integration_accounts.update_one(
        {"user_id": user_id, "provider": provider},
        {"$set": {"token_enc": _enc(_json.dumps(blob)), "label": label, "status": "connected", "updated_at": now},
         "$setOnInsert": {"id": _uuid(), "user_id": user_id, "provider": provider, "created_at": now}},
        upsert=True,
    )


async def _http() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0))


async def _access_token(account: dict, force: bool = False) -> str:
    """Live access token; refresh where the provider supports it.
    `force=True` refreshes even when the stored token looks unexpired — used
    when the provider returns 401 on a token whose local expiry hasn't elapsed
    (e.g. Figma tokens revoked server-side by a re-authorization)."""
    blob = _read_blob(account)
    exp = blob.get("expires_at") or 0
    if not force and (not exp or exp > time.time() + 60):
        return blob["access_token"]
    provider = account["provider"]
    conf = OAUTH_CONF.get(provider) or {}
    refreshed = False
    async with await _http() as c:
        if provider == "gmail":
            r = await c.post("https://oauth2.googleapis.com/token", data={
                "client_id": conf["id"], "client_secret": conf["secret"],
                "refresh_token": blob.get("refresh_token", ""), "grant_type": "refresh_token"})
            if r.status_code == 200:
                tok = r.json()
                blob.update(access_token=tok["access_token"], expires_at=time.time() + int(tok.get("expires_in", 3600)))
                refreshed = True
            else:
                logger.warning("[connect] gmail token refresh failed: status=%s body=%s has_refresh_token=%s",
                               r.status_code, (r.text or "")[:300], bool(blob.get("refresh_token")))
        elif provider == "figma":
            r = await c.post("https://api.figma.com/v1/oauth/refresh", data={"refresh_token": blob.get("refresh_token", "")},
                             auth=(conf["id"], conf["secret"]))
            if r.status_code == 200:
                tok = r.json()
                blob.update(access_token=tok["access_token"], expires_at=time.time() + int(tok.get("expires_in", 7776000)))
                if tok.get("refresh_token"):
                    blob["refresh_token"] = tok["refresh_token"]
                refreshed = True
            else:
                logger.warning("[connect] figma token refresh failed: status=%s body=%s has_refresh_token=%s",
                               r.status_code, (r.text or "")[:300], bool(blob.get("refresh_token")))
        else:
            return blob["access_token"]
    # If we were FORCED to refresh (provider rejected the current token) but the
    # refresh itself failed, the authorization is dead → signal reconnect. Also
    # catch the ordinary local-expiry case.
    if (force and not refreshed) or blob.get("expires_at", 0) <= time.time():
        raise HTTPException(401, f"{PROVIDERS[provider]['label']} connection expired — please reconnect.")
    await db.integration_accounts.update_one({"id": account["id"]}, {"$set": {"token_enc": _enc(_json.dumps(blob))}})
    return blob["access_token"]


async def _get_account(user_id: str, provider: str) -> dict:
    acc = await db.integration_accounts.find_one({"user_id": user_id, "provider": provider}, {"_id": 0})
    if not acc:
        raise HTTPException(400, f"Connect your {PROVIDERS.get(provider, {}).get('label', provider)} account first.")
    return acc


def _connection_health(account: Optional[dict]) -> Dict[str, Any]:
    """Traffic-light health for a source's OAuth token.

    green:  ok           — > 7 days remaining, or provider issues non-expiring tokens.
    amber:  warning      — ≤ 7 days remaining (or ≤ 3d for gmail's hourly tokens).
    red:    expired      — token already dead, or no account row at all.
    """
    if not account:
        return {"level": "red", "state": "expired", "expires_at": None, "days_left": None,
                "message": "Reconnect needed"}
    # Demo sources short-circuit — no real token to check.
    if account.get("is_demo"):
        return {"level": "green", "state": "ok", "expires_at": None, "days_left": None,
                "message": "Demo source"}
    try:
        blob = _read_blob(account)
    except Exception:
        return {"level": "red", "state": "expired", "expires_at": None, "days_left": None,
                "message": "Reconnect needed"}
    provider = account.get("provider", "")
    exp = blob.get("expires_at")
    # Gmail refresh tokens keep the account alive even when access tokens expire hourly.
    # For providers without expiry data (slack/github/notion) treat as always-ok.
    if not exp:
        return {"level": "green", "state": "ok", "expires_at": None, "days_left": None,
                "message": "Healthy"}
    now = time.time()
    if exp <= now:
        # For gmail, an expired access token but a refresh token means we'll silently refresh.
        if provider == "gmail" and blob.get("refresh_token"):
            return {"level": "green", "state": "ok", "expires_at": exp, "days_left": None,
                    "message": "Auto-refreshing"}
        return {"level": "red", "state": "expired", "expires_at": exp, "days_left": 0,
                "message": "Token expired — reconnect"}
    days_left = max(0.0, (exp - now) / 86400.0)
    warn_days = 3 if provider == "gmail" else 7
    if days_left <= warn_days:
        if provider == "gmail" and blob.get("refresh_token"):
            return {"level": "green", "state": "ok", "expires_at": exp, "days_left": days_left,
                    "message": "Auto-refreshing"}
        return {"level": "amber", "state": "warning", "expires_at": exp, "days_left": days_left,
                "message": f"Reconnect in {int(days_left)}d"}
    return {"level": "green", "state": "ok", "expires_at": exp, "days_left": days_left,
            "message": "Healthy"}


# ---------------------------------------------------------------------------
# OAuth flow — generic start + per-provider callback exchange
# ---------------------------------------------------------------------------
from urllib.parse import urlencode


def _auth_url_for(provider: str, state: str, ru: str) -> str:
    conf = OAUTH_CONF[provider]
    if provider == "figma":
        return "https://www.figma.com/oauth?" + urlencode({
            "client_id": conf["id"], "redirect_uri": ru,
            "scope": "current_user:read,file_content:read,file_comments:read",
            "state": state, "response_type": "code"})
    if provider == "gmail":
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": conf["id"], "redirect_uri": ru, "response_type": "code",
            "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            "access_type": "offline", "prompt": "consent select_account", "state": state})
    if provider == "slack":
        return "https://slack.com/oauth/v2/authorize?" + urlencode({
            "client_id": conf["id"], "redirect_uri": ru, "state": state,
            "user_scope": "channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users:read,chat:write"})
    if provider == "github":
        return "https://github.com/login/oauth/authorize?" + urlencode({
            "client_id": conf["id"], "redirect_uri": ru, "scope": "repo", "state": state})
    if provider == "notion":
        return "https://api.notion.com/v1/oauth/authorize?" + urlencode({
            "client_id": conf["id"], "redirect_uri": ru, "response_type": "code",
            "owner": "user", "state": state})
    raise HTTPException(400, "OAuth not supported for this provider.")


async def _exchange_code(provider: str, code: str, ru: str) -> dict:
    """Exchange auth code → token blob + account label."""
    conf = OAUTH_CONF[provider]
    async with await _http() as c:
        if provider == "figma":
            r = await c.post("https://api.figma.com/v1/oauth/token", data={
                "redirect_uri": ru, "code": code, "grant_type": "authorization_code"},
                auth=(conf["id"], conf["secret"]))
            if r.status_code != 200:
                raise HTTPException(400, "Figma authorization failed.")
            tok = r.json()
            blob = {"access_token": tok["access_token"], "refresh_token": tok.get("refresh_token", ""),
                    "expires_at": time.time() + int(tok.get("expires_in", 7776000))}
            me = await c.get("https://api.figma.com/v1/me", headers={"Authorization": f"Bearer {blob['access_token']}"})
            label = (me.json().get("email") if me.status_code == 200 else "") or "Figma account"
            return {"blob": blob, "label": label}
        if provider == "gmail":
            r = await c.post("https://oauth2.googleapis.com/token", data={
                "code": code, "client_id": conf["id"], "client_secret": conf["secret"],
                "redirect_uri": ru, "grant_type": "authorization_code"})
            if r.status_code != 200:
                raise HTTPException(400, "Gmail authorization failed.")
            tok = r.json()
            blob = {"access_token": tok.get("access_token", ""), "refresh_token": tok.get("refresh_token", ""),
                    "expires_at": time.time() + int(tok.get("expires_in", 3600))}
            prof = await c.get("https://gmail.googleapis.com/gmail/v1/users/me/profile",
                               headers={"Authorization": f"Bearer {blob['access_token']}"})
            label = (prof.json().get("emailAddress") if prof.status_code == 200 else "") or "Gmail"
            return {"blob": blob, "label": label}
        if provider == "slack":
            r = await c.post("https://slack.com/api/oauth.v2.access", data={
                "code": code, "client_id": conf["id"], "client_secret": conf["secret"], "redirect_uri": ru})
            data = r.json() if r.status_code == 200 else {}
            authed = (data.get("authed_user") or {})
            if not data.get("ok") or not authed.get("access_token"):
                raise HTTPException(400, "Slack authorization failed.")
            blob = {"access_token": authed["access_token"]}
            label = (data.get("team") or {}).get("name") or "Slack workspace"
            return {"blob": blob, "label": label}
        if provider == "github":
            r = await c.post("https://github.com/login/oauth/access_token", data={
                "code": code, "client_id": conf["id"], "client_secret": conf["secret"], "redirect_uri": ru},
                headers={"Accept": "application/json"})
            tok = r.json() if r.status_code == 200 else {}
            if not tok.get("access_token"):
                raise HTTPException(400, "GitHub authorization failed.")
            blob = {"access_token": tok["access_token"]}
            me = await c.get("https://api.github.com/user", headers=_gh_headers(blob["access_token"]))
            label = (me.json().get("login") if me.status_code == 200 else "") or "GitHub account"
            return {"blob": blob, "label": label}
        if provider == "notion":
            basic = base64.b64encode(f"{conf['id']}:{conf['secret']}".encode()).decode()
            r = await c.post("https://api.notion.com/v1/oauth/token",
                             headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
                             json={"grant_type": "authorization_code", "code": code, "redirect_uri": ru})
            tok = r.json() if r.status_code == 200 else {}
            if not tok.get("access_token"):
                raise HTTPException(400, "Notion authorization failed.")
            blob = {"access_token": tok["access_token"]}
            label = tok.get("workspace_name") or "Notion workspace"
            return {"blob": blob, "label": label}
    raise HTTPException(400, "OAuth not supported for this provider.")


@router.get("/connect/{provider}/auth-url")
async def oauth_auth_url(provider: str, request: Request):
    user = await current_user(request, db)
    if provider not in OAUTH_CONF:
        raise HTTPException(400, "This integration doesn't use OAuth.")
    if PROVIDERS.get(provider, {}).get("impl") == "soon":
        raise HTTPException(400, f"{PROVIDERS[provider]['label']} isn't available yet.")
    if not _configured(provider):
        raise HTTPException(400, f"{PROVIDERS[provider]['label']} isn't configured yet — an admin needs to add its OAuth credentials.")
    state = _uuid()
    ru = _redirect_uri(provider, request)
    await db.oauth_states.insert_one({"state": state, "user_id": user["user_id"], "provider": provider,
                                      "redirect_uri": ru, "created_at": _now_iso()})
    logger.info("[connect] %s auth-url issued user_id=%s redirect_uri=%s", provider, user["user_id"], ru)
    return {"url": _auth_url_for(provider, state, ru)}


_CALLBACK_HTML = """<!doctype html><html><body style="background:#08090A;color:#E8E8EA;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:96vh">
<p>{msg}</p>
<script>
try {{ if (window.opener) window.opener.postMessage("bracket-oauth:{provider}:{result}", "*"); }} catch (e) {{}}
setTimeout(function() {{ window.close(); }}, 1200);
</script></body></html>"""


@router.get("/connect/{provider}/callback")
async def oauth_callback(provider: str, code: str = "", state: str = "", error: str = ""):
    if provider not in OAUTH_CONF:
        raise HTTPException(404, "Unknown provider")
    row = await db.oauth_states.find_one({"state": state, "provider": provider})
    if row:
        await db.oauth_states.delete_one({"state": state})
    if error or not code or not row:
        logger.warning("[connect] %s callback rejected: error=%s has_code=%s state_found=%s", provider, error or "-", bool(code), bool(row))
        return HTMLResponse(_CALLBACK_HTML.format(msg="Authorization was cancelled. You can close this tab.", provider=provider, result="error"), status_code=400)
    try:
        result = await _exchange_code(provider, code, row.get("redirect_uri") or _redirect_uri(provider))
    except HTTPException as e:
        logger.warning("[connect] %s token exchange failed: %s", provider, getattr(e, "detail", str(e)))
        return HTMLResponse(_CALLBACK_HTML.format(msg="Authorization failed. You can close this tab and try again.", provider=provider, result="error"), status_code=400)
    except Exception:
        logger.exception("[connect] %s callback crashed", provider)
        return HTMLResponse(_CALLBACK_HTML.format(msg="Authorization failed. You can close this tab and try again.", provider=provider, result="error"), status_code=400)
    await _store_blob(row["user_id"], provider, result["blob"], result["label"])
    logger.info("[connect] %s connected → stored under user_id=%s label=%s", provider, row["user_id"], result.get("label"))
    return HTMLResponse(_CALLBACK_HTML.format(msg=f"{PROVIDERS[provider]['label']} connected — returning to Bracket…", provider=provider, result="ok"))


# ---------------------------------------------------------------------------
# Provider adapters — list sources / fetch digest
# ---------------------------------------------------------------------------
FIGMA_FILE_RE = re.compile(r"figma\.com/(?:file|design|board|proto)/([A-Za-z0-9]+)")
FIGMA_TEAM_RE = re.compile(r"figma\.com/files/(?:\d+/)?team/(\d+)")


def _fig_headers(token: str) -> dict:
    # OAuth tokens use Bearer; legacy PATs use X-Figma-Token. Bearer works for OAuth only,
    # so send both — Figma ignores the irrelevant one.
    return {"Authorization": f"Bearer {token}", "X-Figma-Token": token}


class FigmaRateLimited(Exception):
    """Figma returned 429. Transient — the caller should back off, NOT mark the
    connection dead or tell the user their file can't be opened."""


async def _figma_get(account: dict, client: httpx.AsyncClient, path: str):
    """GET https://api.figma.com/v1/{path} with automatic token recovery.
    On 401 (token revoked server-side even though our local expiry hasn't
    elapsed) we FORCE a refresh once and retry; a dead refresh raises 401 so the
    source shows a clean 'reconnect'. On 429 we raise FigmaRateLimited."""
    token = await _access_token(account)
    r = await client.get(f"https://api.figma.com/v1/{path}", headers=_fig_headers(token))
    if r.status_code == 401:
        token = await _access_token(account, force=True)  # raises 401 if refresh is dead
        r = await client.get(f"https://api.figma.com/v1/{path}", headers=_fig_headers(token))
    if r.status_code == 429:
        raise FigmaRateLimited()
    return r


def _upstream_fail(provider: str, r, action: str):
    """Log an upstream provider failure and raise a 4xx. We deliberately avoid 5xx
    here: Cloudflare masks any 5xx from the origin with its own 'origin error' page,
    which hides our real, actionable message from the user. A 4xx passes through so
    the source picker can show a friendly 'reconnect / try again' state."""
    body = ""
    try:
        body = (r.text or "")[:400]
    except Exception:
        pass
    logger.warning("[connect] %s %s failed: status=%s body=%s", provider, action, getattr(r, "status_code", "?"), body)
    label = PROVIDERS.get(provider, {}).get("label", provider)
    sc = getattr(r, "status_code", 0)
    if sc == 401:
        raise HTTPException(401, f"{label} connection expired — please reconnect.")
    if sc == 403 and "rate limit" in body.lower():
        raise HTTPException(429, f"{label} rate limit reached — please try again shortly.")
    raise HTTPException(424, f"Couldn't reach {label} right now — please try again.")



async def figma_list_sources(account: dict, q: str, url: str) -> List[dict]:
    try:
        async with await _http() as c:
            # A pasted file link resolves directly to that one file.
            fm = FIGMA_FILE_RE.search(url or "")
            if fm:
                key = fm.group(1)
                r = await _figma_get(account, c, f"files/{key}?depth=1")
                if r.status_code != 200:
                    raise HTTPException(404 if r.status_code == 404 else 403, "Couldn't open that Figma file with your account.")
                f = r.json()
                return [{"id": key, "name": f.get("name") or "Figma file", "url": f"https://www.figma.com/design/{key}",
                         "meta": {"updated": f.get("lastModified", ""), "detail": "Figma file"}}]
            # Fallback: user pasted just the file key or a "key/name?…" path (no domain).
            bare = re.match(r"^\s*([A-Za-z0-9]{15,})(?:[/?].*)?$", url or "")
            if bare:
                key = bare.group(1)
                r = await _figma_get(account, c, f"files/{key}?depth=1")
                if r.status_code == 200:
                    f = r.json()
                    return [{"id": key, "name": f.get("name") or "Figma file", "url": f"https://www.figma.com/design/{key}",
                             "meta": {"updated": f.get("lastModified", ""), "detail": "Figma file"}}]
            # A team link (or a remembered team) lists every file across its projects.
            tm = FIGMA_TEAM_RE.search(url or "")
            team_id = tm.group(1) if tm else (account.get("figma_team_id") or "")
            if not team_id:
                return []
            pr = await _figma_get(account, c, f"teams/{team_id}/projects")
            if pr.status_code != 200:
                raise HTTPException(403, "Couldn't read that Figma team — make sure you're a member and the link is a team link.")
            if tm:
                await db.integration_accounts.update_one({"id": account["id"]}, {"$set": {"figma_team_id": team_id}})
            out: List[dict] = []
            for proj in (pr.json().get("projects") or [])[:12]:
                fr = await _figma_get(account, c, f"projects/{proj['id']}/files")
                if fr.status_code != 200:
                    continue
                for f in (fr.json().get("files") or []):
                    name = f.get("name", "")
                    if q and q.lower() not in name.lower():
                        continue
                    out.append({"id": f["key"], "name": name, "url": f"https://www.figma.com/design/{f['key']}",
                                "meta": {"updated": f.get("last_modified", ""), "detail": proj.get("name", "")}})
                if len(out) >= 60:
                    break
    except FigmaRateLimited:
        raise HTTPException(429, "Figma is temporarily limiting requests on their side (API rate limit). It clears on its own — wait about a minute and try again.")
    out.sort(key=lambda x: x["meta"].get("updated", ""), reverse=True)
    return out[:60]


async def figma_fetch_digest(account: dict, key: str) -> str:
    async with await _http() as c:
        fr = await _figma_get(account, c, f"files/{key}?depth=2")
        cr = await _figma_get(account, c, f"files/{key}/comments")
        vr = await _figma_get(account, c, f"files/{key}/versions")
    if fr.status_code != 200:
        _upstream_fail("figma", fr, "read file")
    f = fr.json()
    lines = [f"FIGMA FILE: {f.get('name')}", f"Last modified: {f.get('lastModified')}"]
    for page in ((f.get("document") or {}).get("children") or [])[:20]:
        frames = [ch.get("name", "") for ch in (page.get("children") or [])[:40]]
        lines.append(f"PAGE '{page.get('name')}': frames/sections = {', '.join(frames) if frames else '(empty)'}")
    comps = f.get("components") or {}
    if comps:
        lines.append(f"Components ({len(comps)}): " + ", ".join(list({c.get('name', '') for c in comps.values()})[:40]))
    if vr.status_code == 200:
        versions = (vr.json().get("versions") or [])[:10]
        if versions:
            lines.append("RECENT VERSIONS:")
            for v in versions:
                lines.append(f"- {v.get('created_at', '')}: {v.get('label') or v.get('description') or 'update'} by {(v.get('user') or {}).get('handle', '')}")
    if cr.status_code == 200:
        comments = (cr.json().get("comments") or [])[:40]
        if comments:
            lines.append("COMMENTS:")
            for cm in comments:
                lines.append(f"- {(cm.get('user') or {}).get('handle', '')} ({cm.get('created_at', '')[:10]}): {(cm.get('message') or '')[:300]}")
    return "\n".join(lines)


# ---- GitHub ---------------------------------------------------------------
def _gh_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


async def github_list_sources(account: dict, q: str) -> List[dict]:
    token = await _access_token(account)
    async with await _http() as c:
        r = await c.get("https://api.github.com/user/repos?sort=pushed&per_page=50", headers=_gh_headers(token))
    if r.status_code != 200:
        _upstream_fail("github", r, "list repos")
    out = []
    for repo in r.json():
        name = repo.get("full_name", "")
        if q and q.lower() not in name.lower():
            continue
        out.append({"id": name, "name": name, "url": repo.get("html_url", ""),
                    "meta": {"updated": repo.get("pushed_at", ""), "detail": (repo.get("description") or "")[:120],
                             "extra": f"{repo.get('open_issues_count', 0)} open issues"}})
    return out[:30]


async def github_fetch_digest(account: dict, full_name: str) -> str:
    token = await _access_token(account)
    h = _gh_headers(token)
    async with await _http() as c:
        rr = await c.get(f"https://api.github.com/repos/{full_name}", headers=h)
        readme = await c.get(f"https://api.github.com/repos/{full_name}/readme", headers={**h, "Accept": "application/vnd.github.raw+json"})
        issues = await c.get(f"https://api.github.com/repos/{full_name}/issues?state=all&per_page=25&sort=updated", headers=h)
        commits = await c.get(f"https://api.github.com/repos/{full_name}/commits?per_page=20", headers=h)
    if rr.status_code != 200:
        raise HTTPException(502, "Couldn't read that GitHub repository.")
    repo = rr.json()
    lines = [f"GITHUB REPO: {repo.get('full_name')}", f"Description: {repo.get('description') or ''}",
             f"Last push: {repo.get('pushed_at', '')}", f"Open issues: {repo.get('open_issues_count', 0)}"]
    if readme.status_code == 200:
        lines.append("README (excerpt):\n" + readme.text[:5000])
    if issues.status_code == 200:
        rows = [i for i in issues.json() if "pull_request" not in i][:20]
        if rows:
            lines.append("ISSUES:")
            for i in rows:
                lines.append(f"- [{i.get('state', '')}] #{i.get('number')} {i.get('title', '')} ({(i.get('updated_at') or '')[:10]}): {(i.get('body') or '')[:220]}")
    if commits.status_code == 200:
        lines.append("RECENT COMMITS:")
        for cm in commits.json()[:15]:
            msg = ((cm.get("commit") or {}).get("message") or "").split("\n")[0][:140]
            date = (((cm.get("commit") or {}).get("author") or {}).get("date") or "")[:10]
            lines.append(f"- {date}: {msg}")
    return "\n".join(lines)


# ---- Notion ---------------------------------------------------------------
NOTION_VERSION = "2022-06-28"


def _notion_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"}


def _notion_title(item: dict) -> str:
    props = item.get("properties") or {}
    tset = (props.get("title") or {}).get("title") or []
    if not tset:
        for p in props.values():
            if p.get("type") == "title":
                tset = p.get("title") or []
                break
    if not tset and item.get("title"):
        tset = item["title"]
    return "".join(x.get("plain_text", "") for x in tset) or "Untitled"


async def notion_list_sources(account: dict, q: str) -> List[dict]:
    token = await _access_token(account)
    body: dict = {"page_size": 30, "filter": {"property": "object", "value": "page"}}
    if q:
        body["query"] = q
    async with await _http() as c:
        r = await c.post("https://api.notion.com/v1/search", headers=_notion_headers(token), json=body)
    if r.status_code != 200:
        _upstream_fail("notion", r, "list pages")
    out = []
    for item in r.json().get("results", []):
        out.append({"id": item["id"], "name": _notion_title(item), "url": item.get("url", ""),
                    "meta": {"updated": item.get("last_edited_time", ""), "detail": "Notion page"}})
    return out


async def _notion_blocks_text(c: httpx.AsyncClient, token: str, block_id: str, depth: int = 0, budget: list = None) -> List[str]:
    if budget is None:
        budget = [220]
    lines: List[str] = []
    cursor = None
    while budget[0] > 0:
        params = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        r = await c.get(f"https://api.notion.com/v1/blocks/{block_id}/children", headers=_notion_headers(token), params=params)
        if r.status_code != 200:
            break
        payload = r.json()
        for block in payload.get("results", []):
            budget[0] -= 1
            data = block.get(block.get("type", ""), {}) or {}
            text = "".join(x.get("plain_text", "") for x in (data.get("rich_text") or []))
            if text:
                lines.append(text)
            if block.get("has_children") and depth < 2 and budget[0] > 0:
                lines.extend(await _notion_blocks_text(c, token, block["id"], depth + 1, budget))
            if budget[0] <= 0:
                break
        if not payload.get("has_more"):
            break
        cursor = payload.get("next_cursor")
    return lines


async def notion_fetch_digest(account: dict, page_id: str) -> str:
    token = await _access_token(account)
    async with await _http() as c:
        pr = await c.get(f"https://api.notion.com/v1/pages/{page_id}", headers=_notion_headers(token))
        if pr.status_code != 200:
            raise HTTPException(502, "Couldn't read that Notion page.")
        page = pr.json()
        lines = await _notion_blocks_text(c, token, page_id)
    return f"NOTION PAGE: {_notion_title(page)}\nLast edited: {page.get('last_edited_time', '')}\n\n" + "\n".join(lines)


# ---- Slack ----------------------------------------------------------------
async def slack_list_sources(account: dict, q: str) -> List[dict]:
    token = await _access_token(account)
    h = {"Authorization": f"Bearer {token}"}
    async with await _http() as c:
        r = await c.get("https://slack.com/api/conversations.list",
                        headers=h, params={"types": "public_channel,private_channel,mpim,im", "limit": 200, "exclude_archived": "true"})
    data = r.json() if r.status_code == 200 else {}
    if not data.get("ok"):
        err = data.get("error") or f"http_{r.status_code}"
        logger.warning("[connect] slack list conversations failed: %s", err)
        if err in ("invalid_auth", "token_revoked", "account_inactive", "not_authed"):
            raise HTTPException(401, "Slack connection expired — please reconnect.")
        if err == "ratelimited":
            raise HTTPException(429, "Slack rate limit reached — please try again shortly.")
        raise HTTPException(424, "Couldn't list your Slack conversations — please try again.")
    out = []
    for ch in data.get("channels", []):
        name = ("#" + ch["name"]) if ch.get("name") else ("DM — " + (ch.get("user") or "direct message"))
        if q and q.lower() not in name.lower():
            continue
        detail = "Channel" if ch.get("is_channel") else ("Private channel" if ch.get("is_group") else "Direct message")
        out.append({"id": ch["id"], "name": name, "url": "",
                    "meta": {"detail": detail, "extra": f"{ch.get('num_members', '')} members" if ch.get("num_members") else ""}})
    return out[:40]


async def slack_fetch_digest(account: dict, channel_id: str) -> str:
    token = await _access_token(account)
    h = {"Authorization": f"Bearer {token}"}
    async with await _http() as c:
        hr = await c.get("https://slack.com/api/conversations.history", headers=h,
                         params={"channel": channel_id, "limit": 100})
        ur = await c.get("https://slack.com/api/users.list", headers=h, params={"limit": 200})
    hdata = hr.json() if hr.status_code == 200 else {}
    if not hdata.get("ok"):
        raise HTTPException(502, "Couldn't read that Slack conversation.")
    names = {}
    udata = ur.json() if ur.status_code == 200 else {}
    for u in (udata.get("members") or []):
        names[u["id"]] = (u.get("profile") or {}).get("real_name") or u.get("name", "")
    lines = ["SLACK CONVERSATION (most recent first):"]
    for m in (hdata.get("messages") or [])[:100]:
        if m.get("subtype") in ("channel_join", "channel_leave"):
            continue
        who = names.get(m.get("user", ""), m.get("user", "someone"))
        ts = datetime.fromtimestamp(float(m.get("ts", 0)), tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
        lines.append(f"- {who} ({ts}): {(m.get('text') or '')[:400]}")
    return "\n".join(lines)[:18000]


# ---- Gmail ----------------------------------------------------------------
async def gmail_list_sources(account: dict, q: str) -> List[dict]:
    at = await _access_token(account)
    headers = {"Authorization": f"Bearer {at}"}
    async with await _http() as c:
        params = {"maxResults": 12}
        if q:
            params["q"] = q
        r = await c.get("https://gmail.googleapis.com/gmail/v1/users/me/threads", headers=headers, params=params)
        if r.status_code != 200:
            _upstream_fail("gmail", r, "list threads")
        out = []
        for th in r.json().get("threads", [])[:12]:
            tr = await c.get(f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{th['id']}",
                             headers=headers, params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]})
            if tr.status_code != 200:
                continue
            data = tr.json()
            msgs = data.get("messages", [])
            hdrs = {h["name"]: h["value"] for h in ((msgs[0].get("payload") or {}).get("headers") or [])} if msgs else {}
            out.append({"id": th["id"], "name": hdrs.get("Subject") or "(no subject)",
                        "url": f"https://mail.google.com/mail/u/0/#all/{th['id']}",
                        "meta": {"updated": hdrs.get("Date", ""), "detail": hdrs.get("From", ""), "extra": f"{len(msgs)} messages"}})
    return out


def _gmail_body_text(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain" and (payload.get("body") or {}).get("data"):
        try:
            return base64.urlsafe_b64decode(payload["body"]["data"] + "==").decode("utf-8", errors="replace")
        except Exception:
            return ""
    for part in payload.get("parts") or []:
        t = _gmail_body_text(part)
        if t:
            return t
    return ""


async def gmail_fetch_digest(account: dict, thread_id: str) -> str:
    at = await _access_token(account)
    async with await _http() as c:
        r = await c.get(f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
                        headers={"Authorization": f"Bearer {at}"}, params={"format": "full"})
    if r.status_code != 200:
        raise HTTPException(502, "Couldn't read that Gmail conversation.")
    msgs = r.json().get("messages", [])
    lines = [f"GMAIL CONVERSATION ({len(msgs)} messages):"]
    for m in msgs[:30]:
        hdrs = {h["name"]: h["value"] for h in ((m.get("payload") or {}).get("headers") or [])}
        body = _gmail_body_text(m.get("payload") or {})[:2500]
        lines.append(f"--- From: {hdrs.get('From', '')} | Date: {hdrs.get('Date', '')} | Subject: {hdrs.get('Subject', '')}\n{body}")
    return "\n".join(lines)[:18000]


async def gmail_fetch_client_digest(account: dict, thread_id: str, client_email: str) -> str:
    """Digest for a connected Gmail source that also captures NEW threads the
    same client started after the source was connected. Without this, only the
    originally-connected thread is re-polled, so brand-new client emails never
    surface until the user manually reconnects. We fold the connected thread
    together with the client's most recent threads into one digest."""
    primary = await gmail_fetch_digest(account, thread_id)
    email = (client_email or "").strip()
    if not email:
        return primary
    at = await _access_token(account)
    try:
        async with await _http() as c:
            r = await c.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/threads",
                headers={"Authorization": f"Bearer {at}"},
                params={"q": f"from:{email} newer_than:21d", "maxResults": 5},
            )
        if r.status_code != 200:
            return primary
        tids = [t["id"] for t in (r.json().get("threads") or []) if t.get("id") and t["id"] != thread_id]
    except Exception:
        return primary
    parts = [primary]
    for tid in tids[:3]:
        try:
            parts.append(await gmail_fetch_digest(account, tid))
        except Exception:
            continue
    return "\n\n=== NEWER CLIENT THREAD ===\n".join(parts)[:24000]
# (Demo/sample source generators removed — Bracket only ever serves live provider data.)


# ---- Dispatch --------------------------------------------------------------
async def _fetch_digest(provider: str, account: dict, source_id: str) -> str:
    if provider == "figma":
        return await figma_fetch_digest(account, source_id)
    if provider == "github":
        return await github_fetch_digest(account, source_id)
    if provider == "notion":
        return await notion_fetch_digest(account, source_id)
    if provider == "gmail":
        return await gmail_fetch_digest(account, source_id)
    if provider == "slack":
        return await slack_fetch_digest(account, source_id)
    raise HTTPException(400, "This integration isn't available yet.")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SourceRef(BaseModel):
    id: str
    name: str = ""
    url: str = ""


class PreviewIn(BaseModel):
    provider: str
    sources: List[SourceRef] = Field(min_length=1, max_length=5)


class EstablishIn(BaseModel):
    preview_id: str
    mode: str  # "new" | "existing"
    project_id: Optional[str] = None


class MemoryActionIn(BaseModel):
    action: str  # confirm | context | ignore | not_a_change | review | dismiss


class MemoryEditIn(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    detail: Optional[str] = Field(default=None, max_length=800)
    category: Optional[str] = Field(default=None, max_length=32)


class MemoryCreateIn(BaseModel):
    category: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(default="", max_length=800)
    status: str = Field(default="confirmed", max_length=16)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


# ---------------------------------------------------------------------------
# Directory + accounts
# ---------------------------------------------------------------------------
@router.get("/connect/providers")
async def list_providers(request: Request):
    user = await current_user(request, db)
    accounts = {a["provider"]: a async for a in db.integration_accounts.find({"user_id": user["user_id"]}, {"_id": 0, "token_enc": 0})}
    out = []
    for key, p in PROVIDERS.items():
        if p["impl"] == "soon":
            status = "coming_soon"
        elif not _configured(key):
            status = "setup_required"
        elif key in accounts:
            status = "connected"
        else:
            status = "available"
        out.append({
            "key": key, "label": p["label"], "category": p["category"], "desc": p["desc"],
            "status": status, "impl": p["impl"],
            "select_mode": p.get("select_mode", "list"), "select_hint": p.get("select_hint", ""),
            "multi": bool(p.get("multi")),
            "account_label": accounts.get(key, {}).get("label", ""),
            "has_team": bool(accounts.get(key, {}).get("figma_team_id")),
        })
    return {"providers": out, "categories": CATEGORY_ORDER}


@router.delete("/connect/accounts/{provider}")
async def delete_account(provider: str, request: Request):
    user = await current_user(request, db)
    await db.integration_accounts.delete_one({"user_id": user["user_id"], "provider": provider})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Source selection + preview + establish (multi-source)
# ---------------------------------------------------------------------------
@router.get("/connect/{provider}/sources")
async def list_sources(provider: str, request: Request, q: str = "", url: str = ""):
    user = await current_user(request, db)
    # Raises 400 when the provider isn't linked yet → the client catches the 400
    # and starts OAuth. Bracket never serves placeholder/sample sources.
    account = await _get_account(user["user_id"], provider)
    logger.info("[connect] %s sources → LIVE fetch user_id=%s label=%s", provider, user["user_id"], account.get("label"))
    if provider == "figma":
        return {"sources": await figma_list_sources(account, q, url)}
    if provider == "github":
        return {"sources": await github_list_sources(account, q)}
    if provider == "notion":
        return {"sources": await notion_list_sources(account, q)}
    if provider == "gmail":
        return {"sources": await gmail_list_sources(account, q)}
    if provider == "slack":
        return {"sources": await slack_list_sources(account, q)}
    raise HTTPException(400, "This integration isn't available yet.")


@router.post("/connect/preview")
async def preview_sources(body: PreviewIn, request: Request):
    user = await current_user(request, db)
    account = await _get_account(user["user_id"], body.provider)
    candidates = []
    async for p in db.projects.find({"owner_user_id": user["user_id"]}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).sort("updated_at", -1).limit(25):
        candidates.append({"id": p["id"], "name": p.get("name", ""), "client": p.get("client_name", "")})

    async def _one(src: SourceRef):
        digest = await _fetch_digest(body.provider, account, src.id)
        if not digest or len(digest) < 40:
            raise HTTPException(422, f"Not enough content in {src.name or src.id}.")
        own_email = account.get("label") or user.get("email", "")
        analysis = await analyze_connected_source(body.provider, src.name or src.id, digest, candidates,
                                                  own_email=own_email, own_name=user.get("name", ""))
        return {"source": src.model_dump(), "digest": digest[:20000], "analysis": analysis}

    results = await asyncio.gather(*(_one(s) for s in body.sources), return_exceptions=True)
    items = [r for r in results if isinstance(r, dict)]
    if not items:
        first_err = next((r for r in results if isinstance(r, Exception)), None)
        if isinstance(first_err, FigmaRateLimited):
            raise HTTPException(429, "Figma is temporarily limiting requests on their side (API rate limit). It clears on its own — wait about a minute and try again.")
        if isinstance(first_err, HTTPException):
            raise first_err
        logger.warning("preview failed: %s", first_err)
        raise HTTPException(502, "Bracket couldn't analyze these sources right now — please try again.")

    counts = {k: 0 for k in ("requirements", "decisions", "deliverables", "deadlines", "open_questions")}
    best_match, proj_info = None, {}
    for it in items:
        a = it["analysis"] or {}
        for k in counts:
            counts[k] += len(a.get(k) or [])
        if not proj_info.get("name"):
            proj_info = a.get("project") or {}
        m = a.get("match") or {}
        conf = int(m.get("confidence") or 0)
        if m.get("project_id") and conf >= 55 and (not best_match or conf > best_match["confidence"]):
            mp = await db.projects.find_one({"id": m["project_id"], "owner_user_id": user["user_id"]}, {"_id": 0, "id": 1, "name": 1, "client_name": 1})
            if mp:
                best_match = {"id": mp["id"], "name": mp.get("name", ""), "client": mp.get("client_name", ""),
                              "confidence": conf, "reason": m.get("reason", "")}

    preview_id = _uuid()
    await db.connect_previews.insert_one({
        "id": preview_id, "user_id": user["user_id"], "provider": body.provider,
        "items": items, "created_at": _now_iso(),
    })
    sample = (items[0]["analysis"] or {})
    return {
        "preview_id": preview_id,
        "project": proj_info,
        "counts": counts,
        "sources": [it["source"] for it in items],
        "failed": max(0, len(body.sources) - len(items)),
        "items": {k: (sample.get(k) or [])[:6] for k in ("requirements", "decisions", "deliverables", "deadlines", "open_questions")},
        "match": best_match,
    }


def _extract_client_email(digest: str, own_email: str) -> str:
    """Pull the client's email out of an already-fetched Gmail digest — the
    first address that isn't the connected user's own."""
    own = (own_email or "").lower()
    for m in re.finditer(r"[\w.+-]+@[\w-]+\.[\w.-]+", digest or ""):
        addr = m.group(0)
        low = addr.lower()
        if low != own and not low.endswith(("@google.com", "@googlemail.com")):
            return addr
    return ""


def _memory_docs(project_id: str, conn_id: str, provider: str, source_label: str, analysis: dict) -> List[dict]:
    now = _now_iso()
    docs = []
    cat_map = {"requirements": "requirement", "decisions": "decision", "deliverables": "deliverable",
               "deadlines": "deadline", "open_questions": "question"}
    for key, cat in cat_map.items():
        for item in (analysis.get(key) or [])[:15]:
            if not isinstance(item, dict) or not item.get("title"):
                continue
            status = item.get("status") if item.get("status") in ("confirmed", "detected") else "detected"
            docs.append({
                "id": _uuid(), "project_id": project_id, "connection_id": conn_id,
                "provider": provider, "source_label": source_label, "category": cat,
                "title": str(item.get("title", ""))[:200], "detail": str(item.get("detail", ""))[:500],
                "status": status, "requested_by": str(item.get("requested_by", ""))[:120],
                "occurred_at": now, "created_at": now, "updated_at": now, "history": [],
            })
    return docs


# ---- Plan-gated project quota --------------------------------------------
# monthly subscription → up to 10 ACTIVE (non-archived) projects, unlimited
# archived; single-project ($9) → 1 active project for 60 days; none → 1.
PLAN_PROJECT_LIMITS = {"monthly": 10, "project": 1, "test": 10, "ph_launch": 1}
PROJECT_PLAN_DAYS = 60
PH_LAUNCH_DAYS = 14


def _plan_limit(plan):
    return PLAN_PROJECT_LIMITS.get(plan, 1)


def _plan_expires_at(user):
    """The $9 single-project plan grants 60 days; the Product Hunt launch offer
    grants 14 days. Returns an aware datetime, or None when the plan never
    expires (monthly / test)."""
    plan = user.get("plan")
    days = {"project": PROJECT_PLAN_DAYS, "ph_launch": PH_LAUNCH_DAYS}.get(plan)
    if not days:
        return None
    since = user.get("plan_since")
    if not since:
        return None
    try:
        start = datetime.fromisoformat(since)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return start + timedelta(days=days)
    except Exception:
        return None


def _plan_expired(user):
    exp = _plan_expires_at(user)
    return bool(exp and datetime.now(timezone.utc) > exp)


async def _active_project_count(uid):
    return await db.projects.count_documents({"owner_user_id": uid, "archived": {"$ne": True}, "is_demo": {"$ne": True}})


def _assert_not_expired(user):
    """Blocks writes on an expired $9 plan (project is read-only until renew/upgrade)."""
    if _plan_expired(user):
        raise HTTPException(402, "Your 60-day project access has ended. Renew or upgrade to keep working on this project.")


@router.get("/project-quota")
async def projects_quota(request: Request):
    user = await current_user(request, db)
    plan = user.get("plan")
    limit = _plan_limit(plan)
    used = await _active_project_count(user["user_id"])
    archived = await db.projects.count_documents({"owner_user_id": user["user_id"], "archived": True})
    exp = _plan_expires_at(user)
    return {
        "plan": plan,
        "limit": limit,
        "used": used,
        "archived": archived,
        "can_create": (limit is None or used < limit) and not _plan_expired(user),
        "plan_expires_at": exp.isoformat() if exp else None,
        "plan_expired": _plan_expired(user),
    }


@router.post("/connect/establish")
async def establish_connection(body: EstablishIn, request: Request):
    user = await current_user(request, db)
    prev = await db.connect_previews.find_one({"id": body.preview_id, "user_id": user["user_id"]}, {"_id": 0})
    if not prev:
        raise HTTPException(404, "Preview expired — please re-select the source.")
    _assert_not_expired(user)
    # Back-compat: previews stored before multi-select had flat fields.
    items = prev.get("items")
    if not items:
        items = [{"source": {"id": prev.get("source_id", ""), "name": prev.get("source_name", ""), "url": prev.get("source_url", "")},
                  "digest": prev.get("digest", ""), "analysis": prev.get("analysis") or {}}]
    provider = prev["provider"]
    first = items[0]["analysis"] or {}
    proj_info = first.get("project") or {}
    now = _now_iso()

    if body.mode == "existing":
        if not body.project_id:
            raise HTTPException(400, "Pick a project to connect this source to.")
        project = await db.projects.find_one({"id": body.project_id, "owner_user_id": user["user_id"]}, {"_id": 0})
        if not project:
            raise HTTPException(404, "Project not found.")
        project_id = project["id"]
        if proj_info.get("client") and not project.get("client_name"):
            await db.projects.update_one({"id": project_id}, {"$set": {"client_name": proj_info["client"], "updated_at": now}})
    else:
        _assert_not_expired(user)
        limit = _plan_limit(user.get("plan"))
        if limit is not None:
            used = await _active_project_count(user["user_id"])
            if used >= limit:
                raise HTTPException(402, "You've reached your plan's active-project limit. Archive a project or upgrade to add more.")
        project_id = _uuid()
        combined_digest = "\n\n".join((it.get("digest") or "")[:4500] for it in items)[:9000]
        await db.projects.insert_one({
            "id": project_id,
            "name": (proj_info.get("name") or (items[0]["source"].get("name")) or "Connected project")[:120],
            "name_source": "ai",
            "creator_name": user.get("name", ""), "creator_email": user["email"],
            "owner_user_id": user["user_id"], "engine": "claude",
            "status": "in_progress", "step": 1,
            "client_name": proj_info.get("client", ""),
            "description": proj_info.get("description", ""),
            "situation_input": {"raw_paste": combined_digest},
            "framing": None, "context_input": None, "context": None,
            "decision_input": None, "decision": None, "artifacts": None,
            "locked_at": None, "feedback": None, "share_token": None,
            "share_status": "none", "share_review": None, "owner_replies": [],
            "created_at": now, "updated_at": now,
        })

    total_mem, connected = 0, []
    own_gmail = ""
    if provider == "gmail":
        try:
            _acc = await _get_account(user["user_id"], "gmail")
            own_gmail = _acc.get("label") or ""
        except Exception:
            own_gmail = ""
    for it in items:
        src = it["source"]
        dup = await db.source_connections.find_one({"project_id": project_id, "provider": provider,
                                                    "source_id": src["id"], "status": {"$ne": "disconnected"}})
        if dup:
            continue
        conn_id = _uuid()
        analysis = it.get("analysis") or {}
        client_email = _extract_client_email(it.get("digest", ""), own_gmail) if provider == "gmail" else ""
        await db.source_connections.insert_one({
            "id": conn_id, "project_id": project_id, "user_id": user["user_id"],
            "provider": provider, "source_type": provider,
            "source_id": src["id"], "source_name": src.get("name") or src["id"], "source_url": src.get("url", ""),
            "client_email": client_email,
            "status": "connected", "content_hash": _hash(it.get("digest", "")),
            "content_cache": (it.get("digest") or "")[:20000],
            "extracted_stats": {k: len(analysis.get(k) or []) for k in ("requirements", "decisions", "deliverables", "deadlines", "open_questions")},
            "last_synced_at": now, "last_activity_at": now, "created_at": now, "updated_at": now,
        })
        mem = _memory_docs(project_id, conn_id, provider, src.get("name") or src["id"], analysis)
        if mem:
            await db.project_memory.insert_many(mem)
        total_mem += len(mem)
        await db.source_events.insert_one({
            "id": _uuid(), "project_id": project_id, "connection_id": conn_id,
            "provider": provider, "source_label": src.get("name") or src["id"],
            "event_type": "SOURCE_CONNECTED",
            "summary": f"Connected {PROVIDERS[provider]['label']} — {src.get('name') or src['id']}. Bracket extracted {len(mem)} items.",
            "occurred_at": now, "created_at": now,
        })
        connected.append(conn_id)
    if not connected:
        raise HTTPException(409, "These sources are already connected to that project.")
    await db.connect_previews.delete_one({"id": body.preview_id})
    return {"ok": True, "project_id": project_id, "connection_ids": connected, "memory_count": total_mem}


# ---------------------------------------------------------------------------
# Project-scoped: connections / memory / activity / ask
# ---------------------------------------------------------------------------
async def _owned_project(project_id: str, request: Request, require_write: bool = False) -> dict:
    user = await current_user(request, db)
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project not found")
    if project.get("owner_user_id") and project["owner_user_id"] != user["user_id"]:
        raise HTTPException(403, "Not your project")
    if require_write:
        _assert_not_expired(user)
    return project


@router.get("/projects/{project_id}/connections")
async def project_connections(project_id: str, request: Request):
    await _owned_project(project_id, request)
    conns = []
    async for c in db.source_connections.find({"project_id": project_id, "provider": {"$ne": "meeting"}, "status": {"$ne": "disconnected"}}, {"_id": 0, "content_cache": 0}):
        if c.get("is_demo"):
            c["health"] = {"level": "green", "state": "ok", "expires_at": None,
                           "days_left": None, "message": "Demo source"}
        elif c.get("provider") == "meeting":
            c["health"] = {"level": "green", "state": "ok", "expires_at": None,
                           "days_left": None, "message": "Meeting notes"}
        else:
            account = await db.integration_accounts.find_one({"user_id": c["user_id"], "provider": c["provider"]}, {"_id": 0})
            c["health"] = _connection_health(account)
        conns.append(c)
    return {"connections": conns}


@router.get("/projects/{project_id}/notes")
async def project_notes(project_id: str, request: Request):
    """List meeting notes / transcripts attached to this project (its own tab —
    separate from live-synced Sources)."""
    await _owned_project(project_id, request)
    notes = []
    async for c in db.source_connections.find(
        {"project_id": project_id, "provider": "meeting", "status": {"$ne": "disconnected"}},
        {"_id": 0, "content_cache": 0},
    ).sort("created_at", -1):
        items = await db.project_memory.count_documents({"connection_id": c["id"], "status": {"$ne": "ignored"}})
        notes.append({
            "id": c["id"], "title": c.get("source_name", ""),
            "created_at": c.get("created_at", ""), "items": items,
        })
    return {"notes": notes}


@router.get("/projects/{project_id}/connections/{conn_id}/content")
async def connection_content(project_id: str, conn_id: str, request: Request):
    """Read-only cached thread/message content for one connected source
    (powers the project 'Conversations' tab)."""
    await _owned_project(project_id, request)
    c = await db.source_connections.find_one(
        {"id": conn_id, "project_id": project_id},
        {"_id": 0, "content_cache": 1, "source_name": 1, "provider": 1, "source_url": 1},
    )
    if not c:
        raise HTTPException(404, "Source not found on this project.")
    return {
        "content": c.get("content_cache", "") or "",
        "source_name": c.get("source_name", ""),
        "provider": c.get("provider", ""),
        "source_url": c.get("source_url", ""),
    }


@router.get("/connect/connections")
async def all_user_connections(request: Request):
    """Every active connection across every project the current user owns.

    Powers the "Disconnect" affordance on the /app/connect provider directory
    (which can't scope to a single project) and any future global connections
    manager.
    """
    user = await current_user(request, db)
    conns = []
    async for c in db.source_connections.find(
        {"user_id": user["user_id"], "status": {"$ne": "disconnected"}},
        {"_id": 0, "content_cache": 0},
    ):
        conns.append(c)
    return {"connections": conns}


MEMORY_CATEGORIES = [
    "scope", "deliverable", "decision", "requirement",
    "timeline", "deadline", "risk", "assumption", "commercial", "question",
]
# Legacy AI-emitted categories that need to be normalised into the canonical
# UI buckets. `deadline` used to fold under `timeline` — no longer, since the
# spec asks for Deadlines as a discrete bucket alongside Timeline. Only
# `scope_change` still folds into `scope` (kept as a "detected" scope item).
_LEGACY_CAT_MAP = {
    "scope_change": "scope",      # scope changes are scope items, kept as detected
}


def _canonical_category(cat: str) -> str:
    return _LEGACY_CAT_MAP.get((cat or "").lower(), (cat or "requirement").lower())


@router.post("/projects/{project_id}/suggest-reply")
async def project_suggest_reply(project_id: str, request: Request):
    """PROJECT-LEVEL suggested reply — chat-style, on-demand.

    User submits an instruction (e.g. "acknowledge the deadline and confirm
    Phase 1 scope") plus prior chat turns; Bracket returns ONE grounded draft.
    The Overview page keeps the thread client-side; every turn hits this
    endpoint so the reply always reflects the freshest memory.
    """
    project = await _owned_project(project_id, request, require_write=True)

    try:
        body = await request.json()
    except Exception:
        body = {}
    instruction = (body.get("instruction") or "").strip()
    history = body.get("history") or []
    if not isinstance(history, list):
        history = []

    # Latest inbound client "message" — the newest memory item detected from a
    # non-manual source. This is the closest we have to "what did the client
    # last say" without owning the raw thread. If none exists we still return
    # a friendly ack reply so the Overview never looks broken.
    latest_msg = None
    async for m in db.project_memory.find(
        {"project_id": project_id, "provider": {"$nin": ["manual", ""]}, "status": {"$ne": "ignored"}},
        {"_id": 0},
    ).sort("created_at", -1).limit(1):
        latest_msg = m

    # Memory context — one line per item, capped at 40 so the prompt stays lean.
    memory_items: List[dict] = []
    async for m in db.project_memory.find(
        {"project_id": project_id, "status": {"$ne": "ignored"}},
        {"_id": 0, "category": 1, "title": 1, "detail": 1},
    ).sort("created_at", -1).limit(40):
        memory_items.append(m)

    try:
        result = await suggest_project_reply(
            project.get("name", ""), project.get("client_name", ""),
            latest_msg or {}, memory_items,
            instruction=instruction, history=history,
        )
    except Exception as e:
        logger.warning("project suggest-reply failed: %s", e)
        raise HTTPException(502, "Bracket couldn't draft a reply right now.")

    reply = result.get("reply", "") or ""
    subject = f"Re: {project.get('name', 'your project')}"
    gmail_web = "https://mail.google.com/mail/?view=cm&fs=1&su={s}&body={b}".format(
        s=_urlq(subject), b=_urlq(reply),
    )
    mailto = "mailto:?subject={s}&body={b}".format(
        s=_urlq(subject), b=_urlq(reply),
    )
    slack_web = "slack://open"

    return {
        "reply": reply,
        "confidence": result.get("confidence", "medium"),
        "grounded_in": result.get("grounded_in", []),
        "based_on": (latest_msg or None) and {
            "id": latest_msg["id"], "title": latest_msg.get("title", ""),
            "provider": latest_msg.get("provider", ""),
            "source_label": latest_msg.get("source_label", ""),
            "created_at": latest_msg.get("created_at", ""),
        },
        "deep_links": {"mailto": mailto, "gmail_web": gmail_web, "slack_web": slack_web},
    }


@router.get("/projects/{project_id}/send-targets")
async def project_send_targets(project_id: str, request: Request):
    """Which channels can this project's reply be sent through — one entry per
    connected channel. Gmail entries carry a pre-populated client recipient
    (derived from the connected thread); Slack entries carry the channel."""
    await _owned_project(project_id, request)
    user = await current_user(request, db)
    targets = []
    gmail_account = None
    gmail_own = ""
    async for c in db.source_connections.find(
        {"project_id": project_id, "status": {"$ne": "disconnected"}}, {"_id": 0}
    ):
        prov = c.get("provider")
        if prov == "gmail":
            to = c.get("client_email") or ""
            if not c.get("is_demo"):
                try:
                    if gmail_account is None:
                        gmail_account = await _get_account(user["user_id"], "gmail")
                        gmail_own = (gmail_account.get("label") or "").lower()
                    if to and to.lower() == gmail_own:
                        to = ""
                    if not to:
                        to = await _gmail_client_email(gmail_account, c.get("source_id", ""))
                    if to and to.lower() == gmail_own:
                        to = ""
                except Exception:
                    pass
            targets.append({
                "provider": "gmail",
                "label": to or (c.get("source_name") or "Gmail thread"),
                "to": to,
                "thread_id": c.get("source_id"),
                "thread_name": c.get("source_name"),
            })
        elif prov == "slack":
            targets.append({
                "provider": "slack",
                "label": f"Post to {c.get('source_name') or 'Slack'}",
                "channel_id": c.get("source_id"),
                "channel_name": c.get("source_name"),
                "is_demo": bool(c.get("is_demo")),
            })
    return {"targets": targets}


async def _gmail_client_email(account: dict, thread_id: str) -> str:
    """Best-effort: the other party's email on the connected Gmail thread."""
    if not thread_id:
        return ""
    at = await _access_token(account)
    own = (account.get("label") or "").lower()
    async with await _http() as c:
        r = await c.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
            headers={"Authorization": f"Bearer {at}"},
            params={"format": "metadata", "metadataHeaders": ["From"]},
        )
    if r.status_code != 200:
        return ""
    for m in r.json().get("messages", []):
        hdrs = {h["name"]: h["value"] for h in ((m.get("payload") or {}).get("headers") or [])}
        mt = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", hdrs.get("From", "") or "")
        addr = mt.group(0) if mt else ""
        if addr and addr.lower() != own:
            return addr
    return ""


async def _confirm_replied_items(project_id: str, source_ids: list) -> int:
    """Reply = Confirm — when the owner replies to a client on a thread/channel,
    the pending (detected/review) items that came from THAT source are marked
    confirmed, since the owner has now acted on them. Scoped to the source
    replied to, so unrelated pending asks are left alone."""
    source_ids = [s for s in source_ids if s]
    if not source_ids:
        return 0
    conns = await db.source_connections.find(
        {"project_id": project_id, "source_id": {"$in": source_ids}}, {"_id": 0, "id": 1}
    ).to_list(length=50)
    conn_ids = [c["id"] for c in conns]
    if not conn_ids:
        return 0
    now = _now_iso()
    res = await db.project_memory.update_many(
        {"project_id": project_id, "connection_id": {"$in": conn_ids}, "status": {"$in": ["detected", "review"]}},
        {"$set": {"status": "confirmed", "updated_at": now},
         "$push": {"history": {"at": now, "action": "confirmed", "note": "Confirmed by your reply"}}},
    )
    return res.modified_count


@router.post("/projects/{project_id}/send-slack")
async def project_send_slack(project_id: str, request: Request):
    """Post the reply to the connected Slack channel directly — no redirect."""
    await _owned_project(project_id, request, require_write=True)
    user = await current_user(request, db)
    try:
        body = await request.json()
    except Exception:
        body = {}
    channel = (body.get("channel_id") or "").strip()
    text = (body.get("body") or "").strip()
    if not channel:
        raise HTTPException(400, "No Slack channel to post to.")
    if not text:
        raise HTTPException(400, "Nothing to send — the reply is empty.")

    account = await _get_account(user["user_id"], "slack")
    token = await _access_token(account)
    async with await _http() as c:
        r = await c.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
            json={"channel": channel, "text": text},
        )
    data = r.json() if r.status_code == 200 else {}
    if not data.get("ok"):
        err = data.get("error", "")
        if err in ("missing_scope", "not_allowed_token_type", "no_permission"):
            raise HTTPException(400, "Bracket can read this Slack but isn't allowed to post yet. Disconnect and reconnect Slack to grant posting permission.")
        if err in ("not_in_channel", "channel_not_found"):
            raise HTTPException(400, "Bracket isn't a member of that Slack channel — add it, then try again.")
        logger.warning("slack send failed %s: %s", r.status_code, data)
        raise HTTPException(502, f"Slack wouldn't post the message ({err or r.status_code}).")
    try:
        confirmed = await _confirm_replied_items(project_id, [channel])
    except Exception as e:
        logger.warning("reply-confirm (slack) failed: %s", e)
        confirmed = 0
    return {"sent": True, "confirmed": confirmed}


@router.post("/projects/{project_id}/send-email")
async def project_send_email(project_id: str, request: Request):
    """Send replies to one or more client threads DIRECTLY via the connected
    Gmail — threaded into the original conversation. Accepts either a single
    {to, thread_id} or a list of {to, thread_id} under `targets`."""
    await _owned_project(project_id, request, require_write=True)
    user = await current_user(request, db)
    try:
        body = await request.json()
    except Exception:
        body = {}
    text = (body.get("body") or "").strip()
    subject_override = (body.get("subject") or "").strip()
    if not text:
        raise HTTPException(400, "Nothing to send — the reply is empty.")

    targets = body.get("targets")
    if not isinstance(targets, list) or not targets:
        targets = [{"to": body.get("to", ""), "thread_id": body.get("thread_id", "")}]
    clean = []
    for t in targets:
        to = (t.get("to") or "").strip()
        if to and "@" in to:
            clean.append({"to": to, "thread_id": (t.get("thread_id") or "").strip()})
    if not clean:
        raise HTTPException(400, "Pick at least one recipient with a valid email.")

    account = await _get_account(user["user_id"], "gmail")
    token = await _access_token(account)

    sent, failed = [], []
    async with await _http() as c:
        for t in clean:
            to, thread_id = t["to"], t["thread_id"]
            # Thread the reply into the original conversation.
            in_reply_to, refs, thread_subject = "", "", ""
            if thread_id:
                try:
                    tr = await c.get(
                        f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
                        headers={"Authorization": f"Bearer {token}"},
                        params={"format": "metadata", "metadataHeaders": ["Message-ID", "Subject", "References"]},
                    )
                    if tr.status_code == 200:
                        msgs = tr.json().get("messages", [])
                        if msgs:
                            last = {h["name"].lower(): h["value"] for h in ((msgs[-1].get("payload") or {}).get("headers") or [])}
                            first = {h["name"].lower(): h["value"] for h in ((msgs[0].get("payload") or {}).get("headers") or [])}
                            in_reply_to = last.get("message-id", "")
                            refs = (last.get("references", "") + " " + in_reply_to).strip()
                            thread_subject = first.get("subject", "")
                except Exception:
                    pass
            subj = subject_override or (f"Re: {thread_subject}" if thread_subject and not thread_subject.lower().startswith("re:") else (thread_subject or "Re: your project"))
            # Build the MIME message via the stdlib email module so the Subject
            # (and any other headers) are RFC-2047 encoded correctly — raw UTF-8
            # bytes in a header render as mojibake ("Ã¢Â€Â") in the client.
            msg = EmailMessage()
            msg["To"] = to
            msg["Subject"] = subj
            if in_reply_to:
                msg["In-Reply-To"] = in_reply_to
                msg["References"] = refs
            msg.set_content(text)
            raw_b64 = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
            payload = {"raw": raw_b64}
            if thread_id:
                payload["threadId"] = thread_id
            r = await c.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
            if r.status_code in (200, 201):
                sent.append(to)
            elif r.status_code == 403:
                raise HTTPException(400, "Bracket can read this Gmail but isn't allowed to send yet. Disconnect and reconnect Gmail to grant send permission.")
            elif r.status_code == 401:
                raise HTTPException(400, "Your Gmail connection expired — reconnect Gmail and try again.")
            else:
                logger.warning("gmail send failed %s: %s", r.status_code, r.text[:200])
                failed.append(to)

    if not sent:
        raise HTTPException(502, "Gmail wouldn't send the message right now.")
    # Reply = Confirm: acting on the thread confirms its pending asks.
    try:
        replied = [t["thread_id"] for t in clean if t["to"] in sent and t.get("thread_id")]
        confirmed = await _confirm_replied_items(project_id, replied)
    except Exception as e:
        logger.warning("reply-confirm (email) failed: %s", e)
        confirmed = 0
    return {"sent": True, "to": sent, "failed": failed, "confirmed": confirmed}


@router.get("/projects/{project_id}/memory")
async def project_memory(project_id: str, request: Request):
    """Return every project-memory item grouped into the canonical categories.

    Legacy AI-emitted categories are mapped to their canonical bucket
    (scope_change → scope) so the UI always sees the same keys.
    """
    await _owned_project(project_id, request)
    grouped: Dict[str, list] = {c: [] for c in MEMORY_CATEGORIES}
    async for m in db.project_memory.find(
        {"project_id": project_id, "status": {"$ne": "ignored"}},
        {"_id": 0},
    ).sort("created_at", -1).limit(500):
        # Stamp `is_scope_change` so the UI can flag scope-creep items even
        # after they get folded into the Scope bucket.
        m["is_scope_change"] = (m.get("category") == "scope_change")
        m["display_category"] = _canonical_category(m.get("category"))
        grouped.setdefault(m["display_category"], []).append(m)
    counts = {k: len(v) for k, v in grouped.items()}
    total = sum(counts.values())
    return {"grouped": grouped, "counts": counts, "total": total, "categories": MEMORY_CATEGORIES}


# ── Consolidated Project Update ──────────────────────────────────────────
# One change, one review, one approval. Instead of approving each detected
# item separately (an endless chain), Bracket bundles ALL pending changes into
# a single snapshot with AI-computed downstream impacts. The user approves or
# rejects the whole thing at once.
_PENDING_STATUSES = ("detected", "review")
_VISIBLE_CATS = ("deliverable", "scope", "timeline", "requirement", "decision", "deadline")


async def _pending_memory(project_id: str) -> list:
    out = []
    async for m in db.project_memory.find(
        {"project_id": project_id, "status": {"$in": list(_PENDING_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).limit(200):
        m["display_category"] = _canonical_category(m.get("category"))
        m["is_scope_change"] = (m.get("category") == "scope_change")
        out.append(m)
    return out


@router.post("/projects/{project_id}/update/build")
async def project_update_build(project_id: str, request: Request):
    """Build ONE consolidated snapshot of every pending change + its downstream
    impacts. Runs a single AI pass (on demand — never on polling)."""
    project = await _owned_project(project_id, request, require_write=True)
    pending = await _pending_memory(project_id)
    if not pending:
        return {"pending": False}

    confirmed = []
    async for m in db.project_memory.find(
        {"project_id": project_id, "status": "confirmed"},
        {"_id": 0, "category": 1, "title": 1},
    ).limit(80):
        confirmed.append(m)

    ai = await build_project_update(
        project.get("name", "your project"), project.get("client_name", ""),
        pending, confirmed,
    )

    direct = [{
        "id": p["id"],
        "category": p["display_category"],
        "title": p.get("title", ""),
        "detail": p.get("detail", ""),
        "provider": p.get("provider", "manual"),
        "source_label": p.get("source_label", ""),
        "requested_by": p.get("requested_by", ""),
        "is_scope_change": p.get("is_scope_change", False),
    } for p in pending]

    downstream = []
    for d in (ai.get("downstream") or []):
        canon = _canonical_category(d.get("category", ""))
        if canon not in _VISIBLE_CATS:
            continue
        title = (d.get("title") or "").strip()
        if not title:
            continue
        downstream.append({
            "category": canon, "title": title,
            "detail": (d.get("detail") or "").strip(),
            "reason": (d.get("reason") or "").strip(),
        })

    now = _now_iso()
    update_id = _uuid()
    snapshot = {
        "id": update_id, "project_id": project_id, "status": "pending",
        "summary": (ai.get("summary") or "").strip(),
        "priority": ai.get("priority", "medium"),
        "impacts": ai.get("impacts") or [],
        "direct_ids": [p["id"] for p in pending],
        "direct": direct,
        "downstream": downstream,
        "created_at": now,
    }
    # Only one pending snapshot per project — supersede any stale one.
    await db.project_updates.delete_many({"project_id": project_id, "status": "pending"})
    await db.project_updates.insert_one(dict(snapshot))
    return {"pending": True, "update": snapshot}


@router.post("/projects/{project_id}/update/{update_id}/approve")
async def project_update_approve(project_id: str, update_id: str, request: Request):
    """Approve the whole snapshot: confirm every direct change and add all
    downstream items — atomically, no new approval chains."""
    await _owned_project(project_id, request, require_write=True)
    user = await current_user(request, db)
    snap = await db.project_updates.find_one(
        {"id": update_id, "project_id": project_id}, {"_id": 0})
    if not snap:
        raise HTTPException(404, "This update no longer exists — refresh and try again.")
    if snap.get("status") != "pending":
        raise HTTPException(409, "This update was already resolved.")
    now = _now_iso()
    try:
        body = await request.json()
    except Exception:
        body = {}
    excl_direct = set(body.get("exclude_direct") or [])
    excl_down = set(body.get("exclude_downstream") or [])

    confirmed = 0
    dismissed = 0
    kept_direct = []
    for p in snap.get("direct", []):
        mid = p["id"]
        if mid in excl_direct:
            res = await db.project_memory.update_one(
                {"id": mid, "status": {"$in": list(_PENDING_STATUSES)}},
                {"$set": {"status": "ignored", "updated_at": now},
                 "$push": {"history": {"to": "ignored", "via": "project_update", "at": now}}},
            )
            dismissed += res.modified_count
        else:
            res = await db.project_memory.update_one(
                {"id": mid, "status": {"$in": list(_PENDING_STATUSES)}},
                {"$set": {"status": "confirmed", "updated_at": now},
                 "$push": {"history": {"to": "confirmed", "via": "project_update", "at": now}}},
            )
            confirmed += res.modified_count
            kept_direct.append(p)

    added = 0
    kept_down = []
    added_ids = []
    for d in snap.get("downstream", []):
        canon = _canonical_category(d.get("category", ""))
        if canon not in _VISIBLE_CATS:
            continue
        if f"{canon}|{d.get('title','')}" in excl_down:
            continue
        doc = {
            "id": _uuid(), "project_id": project_id, "connection_id": "bracket",
            "provider": "bracket", "source_label": "Bracket update",
            "category": canon, "title": d.get("title", ""), "detail": d.get("detail", ""),
            "status": "confirmed", "occurred_at": now, "created_at": now, "updated_at": now,
            "history": [{"created": True, "via": "project_update",
                         "reason": d.get("reason", ""), "by": user["user_id"], "at": now}],
        }
        await db.project_memory.insert_one(doc)
        added += 1
        added_ids.append(doc["id"])
        kept_down.append({"category": canon, "title": d.get("title", "")})

    await db.project_updates.update_one(
        {"id": update_id}, {"$set": {"status": "approved", "resolved_at": now}})
    await db.projects.update_one(
        {"id": project_id}, {"$set": {"last_seen_at": now}})

    # Record ONE grouped history event so users can see why the project changed,
    # without re-reviewing each field. Counts only the KEPT parts.
    _CAT_LABEL = {"scope": "Scope", "deliverable": "Deliverables", "requirement": "Requirements",
                  "decision": "Decisions", "deadline": "Deadline", "timeline": "Timeline"}
    tally: Dict[str, int] = {}
    for p in kept_direct:
        tally[p.get("category", "")] = tally.get(p.get("category", ""), 0) + 1
    for d in kept_down:
        tally[d["category"]] = tally.get(d["category"], 0) + 1
    impact = " · ".join(f"{_CAT_LABEL.get(k, k.title())} +{v}" for k, v in tally.items() if k)
    first = (kept_direct or snap.get("direct") or [{}])[0]
    evt_id = _uuid()
    if confirmed or added:
        await db.source_events.insert_one({
            "id": evt_id, "project_id": project_id, "event_type": "CHANGE_ACCEPTED",
            "summary": snap.get("summary") or "Project change accepted",
            "detail": impact,
            "provider": first.get("provider", "bracket"),
            "source_label": first.get("source_label", "Project change"),
            "by": user["user_id"],
            "occurred_at": now, "created_at": now,
        })
    await db.project_updates.update_one(
        {"id": update_id},
        {"$set": {"applied": {"confirmed_ids": [p["id"] for p in kept_direct],
                              "added_ids": added_ids, "event_id": evt_id if (confirmed or added) else None}}})
    return {"ok": True, "update_id": update_id, "confirmed": confirmed, "added": added, "dismissed": dismissed, "impact": impact}


@router.post("/projects/{project_id}/update/{update_id}/undo")
async def project_update_undo(project_id: str, update_id: str, request: Request):
    """Roll back a just-accepted change: revert confirmed items to pending,
    delete added items, drop the history event, reopen the snapshot."""
    await _owned_project(project_id, request, require_write=True)
    snap = await db.project_updates.find_one(
        {"id": update_id, "project_id": project_id}, {"_id": 0})
    if not snap or snap.get("status") != "approved":
        raise HTTPException(409, "Nothing to undo for this change.")
    applied = snap.get("applied") or {}
    now = _now_iso()
    for mid in applied.get("confirmed_ids", []):
        await db.project_memory.update_one(
            {"id": mid, "project_id": project_id},
            {"$set": {"status": "detected", "updated_at": now},
             "$push": {"history": {"to": "detected", "via": "undo", "at": now}}})
    if applied.get("added_ids"):
        await db.project_memory.delete_many({"id": {"$in": applied["added_ids"]}, "project_id": project_id})
    if applied.get("event_id"):
        await db.source_events.delete_one({"id": applied["event_id"], "project_id": project_id})
    await db.project_updates.update_one(
        {"id": update_id}, {"$set": {"status": "pending"}, "$unset": {"applied": "", "resolved_at": ""}})
    return {"ok": True}


@router.post("/projects/{project_id}/update/{update_id}/reject")
async def project_update_reject(project_id: str, update_id: str, request: Request):
    """Reject the whole snapshot: discard every pending change (marked ignored)
    and add nothing downstream."""
    await _owned_project(project_id, request)
    snap = await db.project_updates.find_one(
        {"id": update_id, "project_id": project_id}, {"_id": 0})
    if not snap:
        raise HTTPException(404, "This update no longer exists — refresh and try again.")
    if snap.get("status") != "pending":
        raise HTTPException(409, "This update was already resolved.")
    now = _now_iso()
    discarded = 0
    for mid in snap.get("direct_ids", []):
        res = await db.project_memory.update_one(
            {"id": mid, "status": {"$in": list(_PENDING_STATUSES)}},
            {"$set": {"status": "ignored", "updated_at": now},
             "$push": {"history": {"to": "ignored", "via": "project_update", "at": now}}},
        )
        discarded += res.modified_count
    await db.project_updates.update_one(
        {"id": update_id}, {"$set": {"status": "rejected", "resolved_at": now}})
    return {"ok": True, "discarded": discarded}


@router.post("/projects/{project_id}/seen")
async def project_seen(project_id: str, request: Request):
    """Record that the user has visited this project now. Returns the PREVIOUS
    visit timestamp so the dashboard can compute 'what changed since last visit'
    — tracked per account so it syncs across devices."""
    project = await _owned_project(project_id, request)
    previous = project.get("last_seen_at")
    await db.projects.update_one(
        {"id": project_id}, {"$set": {"last_seen_at": _now_iso()}})
    return {"previous": previous}



@router.get("/projects/{project_id}/history")
async def project_history(project_id: str, request: Request, limit: int = 60):
    """Unified decision-and-change history for a project.

    Fuses two existing signals so the UI can answer 'why is this project like
    this?':
      - `source_events` — connection lifecycle + poller-detected changes
      - `project_memory.history` — every confirm / dismiss / edit stamped on
        the memory item itself.
    Returned in reverse-chronological order, newest first. Never invents
    anything — every entry has a real `source` (memory item + provider).
    """
    project = await _owned_project(project_id, request)
    limit = max(1, min(int(limit), 200))
    entries: List[dict] = []

    # 1) Source events (SOURCE_CONNECTED, SOURCE_UPDATED, etc.)
    async for e in db.source_events.find(
        {"project_id": project_id}, {"_id": 0},
    ).sort("created_at", -1).limit(limit):
        entries.append({
            "id": e["id"], "kind": e.get("event_type", "SOURCE_EVENT"),
            "title": e.get("summary", ""),
            "provider": e.get("provider", ""), "source_label": e.get("source_label", ""),
            "at": e.get("occurred_at") or e.get("created_at"),
            "memory_id": None, "category": None, "detail": e.get("detail", ""),
        })

    # 2) Memory item history entries.
    async for m in db.project_memory.find(
        {"project_id": project_id}, {"_id": 0},
    ).sort("updated_at", -1).limit(limit):
        canon = _canonical_category(m.get("category"))
        for h in (m.get("history") or []):
            if h.get("edit"):
                title = f"Edited '{m.get('title','')}'"
                kind = "EDITED"
                detail = ", ".join(f"{k}: {v[0]!r} → {v[1]!r}" for k, v in (h["edit"] or {}).items())
            elif h.get("deleted"):
                title = f"Removed '{m.get('title','')}'"
                kind = "REMOVED"; detail = ""
            elif h.get("created"):
                title = f"Added '{m.get('title','')}'"
                kind = "CREATED"; detail = m.get("detail", "")
            elif h.get("to"):
                verb_map = {"confirmed": "Confirmed", "ignored": "Dismissed",
                            "not_a_change": "Marked as not a change",
                            "review": "Sent to review", "context": "Kept as context"}
                verb = verb_map.get(h.get("to"), f"→ {h.get('to')}")
                title = f"{verb}: {m.get('title','')}"
                kind = "STATUS_CHANGE"
                detail = f"from {h.get('from', '?')} to {h.get('to')}"
            else:
                title = m.get("title", ""); kind = "HISTORY"; detail = ""
            entries.append({
                "id": f'{m["id"]}:{h.get("at","")}', "kind": kind, "title": title,
                "provider": m.get("provider", ""), "source_label": m.get("source_label", ""),
                "at": h.get("at") or m.get("updated_at"),
                "memory_id": m["id"], "category": canon, "detail": detail,
            })

    # Sort merged stream by timestamp desc and clip to limit.
    def _key(e):
        return e.get("at") or ""
    entries.sort(key=_key, reverse=True)
    return {"project_id": project_id, "project_name": project.get("name", ""),
            "count": len(entries[:limit]), "entries": entries[:limit]}


@router.get("/projects/{project_id}/activity")
async def project_activity(project_id: str, request: Request):
    await _owned_project(project_id, request)
    events = []
    async for e in db.source_events.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).limit(50):
        events.append(e)
    return {"events": events}


@router.post("/connect/memory/{memory_id}/action")
async def memory_action(memory_id: str, body: MemoryActionIn, request: Request):
    user = await current_user(request, db)
    mem = await db.project_memory.find_one({"id": memory_id}, {"_id": 0})
    if not mem:
        raise HTTPException(404, "Memory item not found")
    project = await db.projects.find_one({"id": mem["project_id"]}, {"_id": 0, "owner_user_id": 1})
    if project and project.get("owner_user_id") and project["owner_user_id"] != user["user_id"]:
        raise HTTPException(403, "Not your project")
    status_map = {
        "confirm": "confirmed", "context": "context", "ignore": "ignored",
        "dismiss": "ignored", "not_a_change": "not_a_change", "review": "review",
    }
    new_status = status_map.get(body.action)
    if not new_status:
        raise HTTPException(400, "Unknown action")
    await db.project_memory.update_one(
        {"id": memory_id},
        {"$set": {"status": new_status, "updated_at": _now_iso()},
         "$push": {"history": {"from": mem.get("status"), "to": new_status, "at": _now_iso()}}},
    )
    return {"ok": True, "status": new_status}


@router.patch("/connect/memory/{memory_id}")
async def memory_edit(memory_id: str, body: MemoryEditIn, request: Request):
    """Inline-edit a memory item. Category can be re-classified; title/detail
    can be corrected. Every change is recorded in `history` so the user can
    see who moved what."""
    user = await current_user(request, db)
    mem = await db.project_memory.find_one({"id": memory_id}, {"_id": 0})
    if not mem:
        raise HTTPException(404, "Memory item not found")
    project = await db.projects.find_one({"id": mem["project_id"]}, {"_id": 0, "owner_user_id": 1})
    if project and project.get("owner_user_id") and project["owner_user_id"] != user["user_id"]:
        raise HTTPException(403, "Not your project")
    updates: Dict[str, Any] = {}
    diff: Dict[str, Any] = {}
    if body.title is not None and body.title.strip() and body.title.strip() != mem.get("title"):
        updates["title"] = body.title.strip(); diff["title"] = [mem.get("title"), updates["title"]]
    if body.detail is not None and body.detail != mem.get("detail", ""):
        updates["detail"] = body.detail.strip(); diff["detail"] = [mem.get("detail"), updates["detail"]]
    if body.category:
        canon = _canonical_category(body.category)
        if canon not in MEMORY_CATEGORIES:
            raise HTTPException(400, "Unknown category")
        if canon != mem.get("category"):
            updates["category"] = canon; diff["category"] = [mem.get("category"), canon]
    if not updates:
        return {"ok": True, "updated": False}
    updates["updated_at"] = _now_iso()
    await db.project_memory.update_one(
        {"id": memory_id},
        {"$set": updates,
         "$push": {"history": {"edit": diff, "by": user["user_id"], "at": _now_iso()}}},
    )
    return {"ok": True, "updated": True, "diff": diff}


@router.post("/projects/{project_id}/memory")
async def memory_create(project_id: str, body: MemoryCreateIn, request: Request):
    """Manually add a memory item (e.g. from a phone call the client didn't
    write down). No source_id required — provider is 'manual'."""
    await _owned_project(project_id, request, require_write=True)
    canon = _canonical_category(body.category)
    if canon not in MEMORY_CATEGORIES:
        raise HTTPException(400, f"Unknown category {body.category}")
    now = _now_iso()
    doc = {
        "id": _uuid(), "project_id": project_id, "connection_id": "manual",
        "provider": "manual", "source_label": "Added by you",
        "category": canon, "title": body.title.strip(), "detail": (body.detail or "").strip(),
        "status": body.status if body.status in ("confirmed", "detected", "review") else "confirmed",
        "occurred_at": now, "created_at": now, "updated_at": now,
        "history": [{"created": True, "by": (await current_user(request, db))["user_id"], "at": now}],
    }
    await db.project_memory.insert_one(doc)
    doc.pop("_id", None)
    return {"item": doc}


@router.delete("/connect/memory/{memory_id}")
async def memory_delete(memory_id: str, request: Request):
    user = await current_user(request, db)
    mem = await db.project_memory.find_one({"id": memory_id}, {"_id": 0})
    if not mem:
        raise HTTPException(404, "Memory item not found")
    project = await db.projects.find_one({"id": mem["project_id"]}, {"_id": 0, "owner_user_id": 1})
    if project and project.get("owner_user_id") and project["owner_user_id"] != user["user_id"]:
        raise HTTPException(403, "Not your project")
    await db.project_memory.update_one(
        {"id": memory_id},
        {"$set": {"status": "ignored", "updated_at": _now_iso()},
         "$push": {"history": {"deleted": True, "by": user["user_id"], "at": _now_iso()}}},
    )
    return {"ok": True}


@router.post("/connect/memory/{memory_id}/suggest-reply")
async def memory_suggest_reply(memory_id: str, request: Request):
    """AI-generates a suggested client reply for a detected change, plus a
    concrete impact list and memory-update plan the UI can visualise. Also
    returns deep-link URLs for Gmail (mailto/compose) and Slack so the user
    can send from one click (no autonomous send — user is always in the loop)."""
    user = await current_user(request, db)
    mem = await db.project_memory.find_one({"id": memory_id}, {"_id": 0})
    if not mem:
        raise HTTPException(404, "Memory item not found")
    project = await db.projects.find_one({"id": mem["project_id"]}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "owner_user_id": 1})
    if not project or (project.get("owner_user_id") and project["owner_user_id"] != user["user_id"]):
        raise HTTPException(403, "Not your project")
    related: List[dict] = []
    async for m in db.project_memory.find(
        {"project_id": mem["project_id"], "status": {"$ne": "ignored"}, "id": {"$ne": memory_id}},
        {"_id": 0, "category": 1, "title": 1, "detail": 1},
    ).sort("created_at", -1).limit(30):
        related.append(m)
    try:
        result = await suggest_reply_for_change(
            project.get("name", ""), project.get("client_name", ""), mem, related
        )
    except Exception as e:
        logger.warning("suggest_reply failed: %s", e)
        raise HTTPException(502, "Bracket couldn't draft a reply right now.")

    reply = result.get("reply", "") or ""
    subject = f"Re: {project.get('name', 'your project')}"
    # Compose deep links — safe, opens the provider's compose window prefilled.
    mailto = "mailto:?subject={s}&body={b}".format(
        s=_urlq(subject), b=_urlq(reply),
    )
    gmail_web = "https://mail.google.com/mail/?view=cm&fs=1&su={s}&body={b}".format(
        s=_urlq(subject), b=_urlq(reply),
    )
    # Slack has no universal prefilled-message deep link; we point at the workspace app.
    slack_web = "slack://open"
    return {
        "reply": reply,
        "impacts": result.get("impacts", []),
        "priority": result.get("priority", "medium"),
        "memory_updates": result.get("memory_updates", []),
        "deep_links": {"mailto": mailto, "gmail_web": gmail_web, "slack_web": slack_web},
    }


def _urlq(s: str) -> str:
    from urllib.parse import quote
    return quote(s or "", safe="")


@router.post("/projects/{project_id}/ask")
async def ask_project(project_id: str, body: AskIn, request: Request):
    # Alias: `/api/projects/all/ask` is equivalent to `/api/ask/all` so
    # callers can use the same URL shape everywhere.
    if project_id == "all":
        return await ask_across_projects(body, request)
    project = await _owned_project(project_id, request)
    memory = []
    async for m in db.project_memory.find({"project_id": project_id, "status": {"$ne": "ignored"}}, {"_id": 0}).sort("created_at", -1).limit(80):
        memory.append(m)
    digests = []
    async for c in db.source_connections.find({"project_id": project_id, "status": {"$ne": "disconnected"}}, {"_id": 0, "source_name": 1, "provider": 1, "content_cache": 1}).limit(4):
        digests.append({"label": c.get("source_name", ""), "provider": c.get("provider", ""), "content": c.get("content_cache", "")})
    if not memory and not digests:
        raise HTTPException(422, "Connect a source first — Bracket answers from connected work only.")
    try:
        result = await answer_project_question(project.get("name", ""), body.question, memory, digests)
    except Exception as e:
        logger.warning("ask project failed: %s", e)
        raise HTTPException(502, "Bracket couldn't answer right now — please try again.")
    return result


# ---------------------------------------------------------------------------
# Sync engine — shared by manual "Sync now" and the background poller
# ---------------------------------------------------------------------------
def _event_uid(conn_id: str, provider: str, raw: str) -> str:
    return hashlib.sha1(f"{conn_id}|{provider}|{raw.strip()[:400]}".encode()).hexdigest()[:20]


def _owner_idents(account: dict) -> set:
    vals = set()
    for k in ("label", "name", "external_name", "handle", "email"):
        v = str(account.get(k) or "").strip().lower()
        if v:
            vals.add(v)
    return vals


def _split_events(provider: str, conn_id: str, digest: str, owner_idents: set) -> list:
    """Break a source digest into individual events (one per message / comment /
    commit / issue) with a STABLE id and an owner flag. This is what lets sync
    dedup per-event and skip the freelancer's own replies."""
    units = []
    if not digest:
        return units
    if provider == "gmail":
        for b in re.split(r"\n(?=--- From:)", digest):
            b = b.strip()
            if not b.startswith("--- From:"):
                continue
            header = b.split("\n", 1)[0].lower()
            is_owner = any(("@" in ident and ident in header) for ident in owner_idents)
            units.append({"uid": _event_uid(conn_id, provider, b), "is_owner": is_owner, "text": b})
    else:
        # Figma is a DESIGN surface: a comment the owner leaves on the file is a
        # real design note worth capturing, so we do NOT treat owner-authored
        # Figma comments as "own replies" to skip. For chat-like sources
        # (Slack/GitHub), the owner's own lines are still skipped.
        skip_owner = provider != "figma"
        for ln in digest.split("\n"):
            s = ln.strip()
            if not s.startswith("- "):
                continue
            m = re.match(r"- ([^(]+?) \(", s)  # "- Author (date): message"
            author = m.group(1).strip().lower() if m else ""
            is_owner = skip_owner and bool(author) and author in owner_idents
            units.append({"uid": _event_uid(conn_id, provider, s), "is_owner": is_owner, "text": s})
    return units


async def _sync_connection(conn: dict) -> dict:
    account = await db.integration_accounts.find_one({"user_id": conn["user_id"], "provider": conn["provider"]}, {"_id": 0})
    now = _now_iso()
    if not account:
        await db.source_connections.update_one({"id": conn["id"]}, {"$set": {"status": "needs_attention", "last_synced_at": now, "updated_at": now}})
        return {"changed": False, "status": "needs_attention"}
    try:
        # Scope every source to its OWN thread/conversation only. We deliberately
        # do NOT pull in a Gmail client's other recent threads anymore — that
        # caused unrelated projects to bleed into a project's memory. Each source
        # stays tied to exactly the conversation the user attached.
        digest = await _fetch_digest(conn["provider"], account, conn["source_id"])
    except FigmaRateLimited:
        # Transient: Figma is throttling us. Keep the connection healthy and just
        # back off — the per-provider poll interval spaces the next attempt out.
        await db.source_connections.update_one({"id": conn["id"]}, {"$set": {"status": "connected", "last_synced_at": now, "updated_at": now}})
        return {"changed": False, "status": "connected", "rate_limited": True}
    except HTTPException as e:
        status = "expired" if e.status_code == 401 else "error"
        # Stamp last_synced_at even on failure so a transiently-failing source
        # rotates to the BACK of the poller queue instead of monopolising it —
        # and so the background poller (which now retries error/expired sources)
        # doesn't hammer the same broken connection every cycle.
        await db.source_connections.update_one({"id": conn["id"]}, {"$set": {"status": status, "last_synced_at": now, "updated_at": now}})
        return {"changed": False, "status": status}
    h = _hash(digest)
    if h == conn.get("content_hash"):
        await db.source_connections.update_one({"id": conn["id"]}, {"$set": {"last_synced_at": now, "status": "connected", "updated_at": now}})
        return {"changed": False, "status": "connected"}

    # ---- Per-event processing ledger ------------------------------------
    # Dedup at the level of individual messages/comments/commits (NOT the whole
    # thread) so historical content is never re-extracted and the same change
    # can't fire repeat alerts. Events the OWNER authored (their own replies)
    # are marked processed but never analysed — a freelancer's reply must not
    # change project truth.
    owner_idents = _owner_idents(account)
    units = _split_events(conn["provider"], conn["id"], digest, owner_idents)
    processed = set(conn.get("processed_event_ids") or [])
    if "processed_event_ids" not in conn:
        # First time this source is ledgered: everything already captured in the
        # connect-time baseline (content_cache) counts as processed, so we never
        # re-mine history the initial extraction already covered.
        baseline = _split_events(conn["provider"], conn["id"], conn.get("content_cache") or "", owner_idents)
        processed |= {u["uid"] for u in baseline}

    new_units = [u for u in units if u["uid"] not in processed]
    client_units = [u for u in new_units if not u["is_owner"]]
    all_processed = list(processed | {u["uid"] for u in units})[-800:]

    # Nothing genuinely new from the client (only the owner's own replies, or no
    # change worth analysing) → record the ledger and stop. No re-extraction,
    # no alerts.
    if not client_units:
        await db.source_connections.update_one({"id": conn["id"]}, {"$set": {
            "content_hash": h, "content_cache": digest[:20000], "processed_event_ids": all_processed,
            "last_synced_at": now, "status": "connected", "updated_at": now,
        }})
        return {"changed": False, "status": "connected", "new_items": 0}

    memory_titles = []
    async for m in db.project_memory.find({"project_id": conn["project_id"], "status": {"$ne": "ignored"}}, {"_id": 0, "title": 1}).limit(60):
        memory_titles.append(m["title"])
    project = await db.projects.find_one({"id": conn["project_id"]}, {"_id": 0, "name": 1})
    # Analyse ONLY the genuinely-new client events — never the whole thread.
    focused = (f"NEW {conn['provider'].upper()} ACTIVITY in {conn['source_name']}:\n"
               + "\n".join(u["text"] for u in client_units))[:16000]
    new_items, events = [], []
    try:
        result = await detect_source_updates(conn["provider"], conn["source_name"], (project or {}).get("name", ""), memory_titles, focused)
        events = result.get("events") or []
        new_items = result.get("new_items") or []
    except Exception as e:
        logger.warning("change detection failed for %s: %s", conn["id"], e)

    cat_ok = {"requirement", "decision", "deliverable", "deadline", "scope_change", "question"}
    mem_docs = []
    for item in new_items[:10]:
        if not isinstance(item, dict) or not item.get("title"):
            continue
        mem_docs.append({
            "id": _uuid(), "project_id": conn["project_id"], "connection_id": conn["id"],
            "provider": conn["provider"], "source_label": conn["source_name"],
            "category": item.get("category") if item.get("category") in cat_ok else "event",
            "title": str(item["title"])[:200], "detail": str(item.get("detail", ""))[:500],
            # A change detected on an ONGOING sync is always surfaced for review —
            # never auto-confirmed — so the owner gets a notification for every
            # real client update. The AI's confirmed/detected guess is only
            # trusted for the INITIAL baseline extraction at project creation.
            "status": "detected",
            "requested_by": str(item.get("requested_by", ""))[:120],
            "occurred_at": now, "created_at": now, "updated_at": now, "history": [],
        })
    if mem_docs:
        await db.project_memory.insert_many(mem_docs)

    # Notifications — deduped by fingerprint so the SAME detected change can
    # never surface (or later email) twice. The email itself is NOT sent here:
    # fresh scope asks are queued as `digested:false` notifications and a daily
    # digest job batches them into one email per owner (send_scope_digest).
    alerted = set(conn.get("alerted_fingerprints") or [])
    scope_items = [d for d in mem_docs if d["category"] == "scope_change"]
    fresh_scope = [s for s in scope_items if _hash(s["title"].strip().lower())[:16] not in alerted]
    if fresh_scope:
        project_name = (project or {}).get("name", "") or "your project"
        await db.notifications.insert_many([{
            "id": _uuid(), "user_id": conn["user_id"], "project_id": conn["project_id"],
            "project_name": project_name, "connection_id": conn["id"],
            "provider": conn["provider"], "source_label": conn["source_name"],
            "memory_id": s["id"], "type": "scope_creep",
            "title": s["title"], "detail": s.get("detail", ""),
            "read": False, "digested": False, "created_at": now,
        } for s in fresh_scope[:6]])
        alerted |= {_hash(s["title"].strip().lower())[:16] for s in fresh_scope}

    ev_docs = []
    for ev in events[:8]:
        if not isinstance(ev, dict) or not ev.get("summary"):
            continue
        ev_docs.append({
            "id": _uuid(), "project_id": conn["project_id"], "connection_id": conn["id"],
            "provider": conn["provider"], "source_label": conn["source_name"],
            "event_type": ev.get("event_type", "ACTIVITY"), "summary": str(ev["summary"])[:300],
            "occurred_at": now, "created_at": now,
        })
    if not ev_docs and mem_docs:
        ev_docs.append({
            "id": _uuid(), "project_id": conn["project_id"], "connection_id": conn["id"],
            "provider": conn["provider"], "source_label": conn["source_name"],
            "event_type": "SOURCE_UPDATED", "summary": f"{conn['source_name']} changed — {len(mem_docs)} new items detected.",
            "occurred_at": now, "created_at": now,
        })
    if ev_docs:
        await db.source_events.insert_many(ev_docs)
    await db.source_connections.update_one({"id": conn["id"]}, {"$set": {
        "content_hash": h, "content_cache": digest[:20000],
        "processed_event_ids": all_processed, "alerted_fingerprints": list(alerted)[-400:],
        "last_synced_at": now, "last_activity_at": now, "status": "connected", "updated_at": now,
    }})
    return {"changed": True, "status": "connected", "new_items": len(mem_docs), "events": len(ev_docs)}


@router.post("/connect/connections/{connection_id}/sync")
async def sync_now(connection_id: str, request: Request):
    user = await current_user(request, db)
    conn = await db.source_connections.find_one({"id": connection_id, "user_id": user["user_id"]}, {"_id": 0})
    if not conn:
        raise HTTPException(404, "Connection not found")
    if conn.get("is_demo"):
        return {"changed": False, "status": "connected", "new_items": 0, "demo": True}
    return await _sync_connection(conn)


_NOTES_MAX = 60000
_NOTES_UPLOAD_MAX_BYTES = 8 * 1024 * 1024  # 8 MB cap before reading into memory


def _parse_uploaded_notes(filename: str, raw: bytes) -> str:
    """Best-effort plain-text extraction from an uploaded notes file
    (.txt/.md/.docx/.pdf). Never persists the file — text only."""
    name = (filename or "").lower()
    try:
        if name.endswith(".docx"):
            import io
            import docx  # python-docx
            d = docx.Document(io.BytesIO(raw))
            return "\n".join(p.text for p in d.paragraphs)
        if name.endswith(".pdf"):
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            return "\n".join((pg.extract_text() or "") for pg in reader.pages)
    except Exception as e:
        logger.warning("notes file parse failed for %s: %s", name, e)
        return ""
    # .txt / .md / unknown → decode as utf-8
    return raw.decode("utf-8", errors="ignore")


@router.post("/projects/{project_id}/ingest-notes")
async def ingest_notes(
    project_id: str,
    request: Request,
    text: str = Form(""),
    title: str = Form(""),
    file: UploadFile = File(None),
):
    """Attach meeting notes / a transcript (pasted text or an uploaded
    .txt/.md/.docx/.pdf). Bracket extracts changes vs the existing memory and
    adds them as PENDING (detected) items for the owner to review."""
    project = await _owned_project(project_id, request, require_write=True)
    user = await current_user(request, db)

    notes = (text or "").strip()
    if file is not None:
        raw = await file.read()
        if len(raw) > _NOTES_UPLOAD_MAX_BYTES:
            raise HTTPException(413, "That file is too large. Please keep meeting notes under 8 MB.")
        if raw:
            parsed = _parse_uploaded_notes(file.filename or "", raw).strip()
            notes = (notes + "\n\n" + parsed).strip() if notes else parsed
    notes = notes[:_NOTES_MAX]
    if len(notes) < 40:
        raise HTTPException(422, "Please paste more notes, or upload a readable .txt, .md, .docx or .pdf file.")

    now = _now_iso()
    src_title = (title or "").strip() or f"Meeting notes · {now[:10]}"
    conn_id = _uuid()
    await db.source_connections.insert_one({
        "id": conn_id, "project_id": project_id, "user_id": user["user_id"],
        "provider": "meeting", "source_id": conn_id, "source_name": src_title,
        "status": "connected", "content_hash": _hash(notes), "content_cache": notes[:20000],
        "last_synced_at": now, "last_activity_at": now, "created_at": now, "updated_at": now,
    })

    memory_titles = []
    async for m in db.project_memory.find(
        {"project_id": project_id, "status": {"$ne": "ignored"}}, {"_id": 0, "title": 1}
    ).limit(60):
        memory_titles.append(m["title"])

    new_items, events = [], []
    try:
        result = await extract_from_notes(project.get("name", ""), memory_titles, notes)
        events = result.get("events") or []
        new_items = result.get("new_items") or []
    except Exception as e:
        logger.warning("notes extraction failed for %s: %s", conn_id, e)

    cat_ok = {"requirement", "decision", "deliverable", "deadline", "scope_change", "question"}
    mem_docs = []
    for item in new_items[:15]:
        if not isinstance(item, dict) or not item.get("title"):
            continue
        mem_docs.append({
            "id": _uuid(), "project_id": project_id, "connection_id": conn_id,
            "provider": "meeting", "source_label": src_title,
            "category": item.get("category") if item.get("category") in cat_ok else "event",
            "title": str(item["title"])[:200], "detail": str(item.get("detail", ""))[:500],
            "status": "detected", "requested_by": str(item.get("requested_by", ""))[:120],
            "occurred_at": now, "created_at": now, "updated_at": now, "history": [],
        })
    if mem_docs:
        await db.project_memory.insert_many(mem_docs)

    # Scope-creep notifications (same treatment as a live sync).
    scope_items = [d for d in mem_docs if d["category"] == "scope_change"]
    if scope_items:
        await db.notifications.insert_many([{
            "id": _uuid(), "user_id": user["user_id"], "project_id": project_id,
            "project_name": project.get("name", "") or "your project", "connection_id": conn_id,
            "provider": "meeting", "source_label": src_title, "memory_id": s["id"],
            "type": "scope_creep", "title": s["title"], "detail": s.get("detail", ""),
            "read": False, "created_at": now,
        } for s in scope_items[:6]])

    ev_docs = []
    for ev in events[:8]:
        if not isinstance(ev, dict) or not ev.get("summary"):
            continue
        ev_docs.append({
            "id": _uuid(), "project_id": project_id, "connection_id": conn_id,
            "provider": "meeting", "source_label": src_title,
            "event_type": ev.get("event_type", "ACTIVITY"), "summary": str(ev["summary"])[:300],
            "occurred_at": now, "created_at": now,
        })
    ev_docs.append({
        "id": _uuid(), "project_id": project_id, "connection_id": conn_id,
        "provider": "meeting", "source_label": src_title,
        "event_type": "NOTES_ADDED", "summary": f"{src_title} added — {len(mem_docs)} update(s) detected.",
        "occurred_at": now, "created_at": now,
    })
    await db.source_events.insert_many(ev_docs)

    return {"added": len(mem_docs), "events": len(ev_docs), "connection_id": conn_id, "title": src_title}



@router.delete("/connect/connections/{connection_id}")
async def disconnect(connection_id: str, request: Request):
    user = await current_user(request, db)
    conn = await db.source_connections.find_one({"id": connection_id, "user_id": user["user_id"]}, {"_id": 0})
    if not conn:
        raise HTTPException(404, "Connection not found")
    now = _now_iso()
    await db.source_connections.update_one({"id": connection_id}, {"$set": {"status": "disconnected", "content_cache": "", "updated_at": now}})
    await db.source_events.insert_one({
        "id": _uuid(), "project_id": conn["project_id"], "connection_id": connection_id,
        "provider": conn["provider"], "source_label": conn["source_name"],
        "event_type": "SOURCE_DISCONNECTED", "summary": f"Disconnected {conn['source_name']}.",
        "occurred_at": now, "created_at": now,
    })
    # If that was the user's last active source for this provider, also drop the
    # stored OAuth account so the tool is fully disconnected — a later reconnect
    # then forces a fresh sign-in and account selection (rather than silently
    # reusing the old token / account).
    remaining = await db.source_connections.count_documents({
        "user_id": user["user_id"], "provider": conn["provider"], "status": {"$ne": "disconnected"},
    })
    account_removed = False
    if remaining == 0:
        res = await db.integration_accounts.delete_one({"user_id": user["user_id"], "provider": conn["provider"]})
        account_removed = bool(res.deleted_count)
    return {"ok": True, "account_removed": account_removed}


# ---------------------------------------------------------------------------
# Change Digest — "what changed" across every project the user owns.
# ---------------------------------------------------------------------------
_WINDOW_HOURS = {"24h": 24, "7d": 24 * 7}
_DIGEST_CATS = ("decision", "deadline", "scope_change", "requirement", "deliverable", "question")


@router.get("/connect/digest")
async def change_digest(request: Request, window: str = "24h"):
    """Roll-up of new memory + activity across every project the user owns
    inside the selected window. Feeds the dashboard 'what changed' panel."""
    user = await current_user(request, db)
    hours = _WINDOW_HOURS.get(window, 24)
    since = (datetime.now(timezone.utc).timestamp() - hours * 3600)
    since_iso = datetime.fromtimestamp(since, tz=timezone.utc).isoformat()

    # Only look inside projects owned by this user.
    project_ids: List[str] = []
    projects_by_id: Dict[str, dict] = {}
    async for p in db.projects.find({"owner_user_id": user["user_id"]}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}):
        project_ids.append(p["id"])
        projects_by_id[p["id"]] = p
    if not project_ids:
        return {"window": window, "counts": {c: 0 for c in _DIGEST_CATS},
                "total": 0, "items": [], "projects_with_changes": 0,
                "scope_alerts": 0, "generated_at": _now_iso()}

    q = {"project_id": {"$in": project_ids}, "created_at": {"$gte": since_iso},
         "status": {"$ne": "ignored"}}
    counts = {c: 0 for c in _DIGEST_CATS}
    items: List[dict] = []
    proj_touched = set()
    scope_alerts = 0
    async for m in db.project_memory.find(q, {"_id": 0}).sort("created_at", -1).limit(200):
        cat = m.get("category", "")
        if cat in counts:
            counts[cat] += 1
        if cat == "scope_change":
            scope_alerts += 1
        proj_touched.add(m["project_id"])
        proj = projects_by_id.get(m["project_id"], {})
        if len(items) < 60:
            items.append({
                "id": m["id"], "project_id": m["project_id"],
                "project_name": proj.get("name", ""),
                "client_name": proj.get("client_name", ""),
                "category": cat, "title": m.get("title", ""),
                "detail": m.get("detail", ""), "status": m.get("status", "detected"),
                "provider": m.get("provider", ""), "source_label": m.get("source_label", ""),
                "created_at": m.get("created_at", ""),
            })
    total = sum(counts.values())
    return {"window": window, "counts": counts, "total": total,
            "items": items, "projects_with_changes": len(proj_touched),
            "scope_alerts": scope_alerts, "generated_at": _now_iso()}


# ---------------------------------------------------------------------------
# Notifications — scope creep + other AI-detected risks. In-app bell only.
# ---------------------------------------------------------------------------
class MarkReadIn(BaseModel):
    ids: Optional[List[str]] = None  # None = mark all read


@router.get("/notifications")
async def list_notifications(request: Request, limit: int = 30):
    user = await current_user(request, db)
    limit = max(1, min(int(limit), 100))
    items = []
    async for n in db.notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(limit):
        items.append(n)
    unread = await db.notifications.count_documents({"user_id": user["user_id"], "read": False})
    return {"items": items, "unread": unread}


@router.post("/notifications/read")
async def mark_notifications_read(body: MarkReadIn, request: Request):
    user = await current_user(request, db)
    q: Dict[str, Any] = {"user_id": user["user_id"], "read": False}
    if body.ids:
        q["id"] = {"$in": body.ids[:200]}
    r = await db.notifications.update_many(q, {"$set": {"read": True, "read_at": _now_iso()}})
    return {"ok": True, "updated": r.modified_count}


# ---------------------------------------------------------------------------
# Cross-source Ask — answer using memory + digests from ALL user's projects.
# ---------------------------------------------------------------------------
@router.post("/ask/all")
async def ask_across_projects(body: AskIn, request: Request):
    user = await current_user(request, db)
    proj_names: Dict[str, str] = {}
    async for p in db.projects.find({"owner_user_id": user["user_id"]}, {"_id": 0, "id": 1, "name": 1}):
        proj_names[p["id"]] = p.get("name", "")
    if not proj_names:
        raise HTTPException(422, "Connect a source first — Bracket answers from connected work only.")

    memory = []
    async for m in db.project_memory.find(
        {"project_id": {"$in": list(proj_names.keys())}, "status": {"$ne": "ignored"}},
        {"_id": 0},
    ).sort("created_at", -1).limit(120):
        # Stamp the project label so citations show which project a claim came from.
        m["source_label"] = f'{proj_names.get(m["project_id"], "")} · {m.get("source_label", "")}'.strip(" ·")
        memory.append(m)

    digests = []
    async for c in db.source_connections.find(
        {"project_id": {"$in": list(proj_names.keys())}, "status": {"$ne": "disconnected"}},
        {"_id": 0, "source_name": 1, "provider": 1, "content_cache": 1, "project_id": 1},
    ).sort("last_activity_at", -1).limit(6):
        label = f'{proj_names.get(c["project_id"], "")} · {c.get("source_name", "")}'.strip(" ·")
        digests.append({"label": label, "provider": c.get("provider", ""), "content": c.get("content_cache", "")})

    if not memory and not digests:
        raise HTTPException(422, "Connect a source first — Bracket answers from connected work only.")
    try:
        result = await answer_project_question("all your projects", body.question, memory, digests)
    except Exception as e:
        logger.warning("cross-source ask failed: %s", e)
        raise HTTPException(502, "Bracket couldn't answer right now — please try again.")
    return result


# ---------------------------------------------------------------------------
# Legacy demo cleanup — Bracket no longer seeds any demo/sample project. This
# endpoint only purges any leftover legacy demo project from earlier versions.
# ---------------------------------------------------------------------------
_DEMO_TAG = "demo:acme_dashboard_redesign"


@router.delete("/demo/reset")
async def demo_reset(request: Request):
    """Delete the demo project + its memory + connections (used by the 'Delete demo'
    button on the project page)."""
    user = await current_user(request, db)
    proj = await db.projects.find_one(
        {"owner_user_id": user["user_id"], "demo_tag": _DEMO_TAG}, {"_id": 0, "id": 1},
    )
    if not proj:
        return {"ok": True, "deleted": False}
    pid = proj["id"]
    await db.project_memory.delete_many({"project_id": pid})
    await db.source_connections.delete_many({"project_id": pid})
    await db.notifications.delete_many({"project_id": pid})
    await db.projects.delete_one({"id": pid})
    return {"ok": True, "deleted": True}


# ---------------------------------------------------------------------------
# Background poller — cadence tuned to feel "live" (60s per-connection sync,
# up to 8 stale connections per cycle) while respecting provider rate limits.
# Frontend polls the DB every 10s so the perceived refresh cadence is short.
# ---------------------------------------------------------------------------
POLL_INTERVAL_S = 30
POLL_BATCH = 12
# Per-provider minimum seconds between AUTOMATIC syncs of the same source.
# Figma's file endpoint is cost-limited, so we don't sync it as aggressively as
# chat/mail — but users also get a manual "Sync now" button for on-demand pulls.
PROVIDER_MIN_SYNC_S = {"figma": 300, "github": 300}


async def poller_loop():
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_S)
            now_ts = datetime.now(timezone.utc).timestamp()
            count = 0
            async for conn in db.source_connections.find({"status": {"$in": ["connected", "error", "expired"]}, "provider": {"$ne": "meeting"}, "is_demo": {"$ne": True}}, {"_id": 0}).sort("last_synced_at", 1).limit(40):
                try:
                    last = datetime.fromisoformat(conn.get("last_synced_at", "").replace("Z", "+00:00")).timestamp()
                except Exception:
                    last = 0
                min_gap = PROVIDER_MIN_SYNC_S.get(conn.get("provider"), POLL_INTERVAL_S)
                if last > now_ts - min_gap:
                    continue
                try:
                    await _sync_connection(conn)
                except Exception as e:
                    logger.warning("poll sync failed for %s: %s", conn.get("id"), e)
                count += 1
                if count >= POLL_BATCH:
                    break
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.warning("connector poller iteration failed: %s", e)


async def scope_digest_loop():
    """Once per 24h per owner: batch all new (un-digested) scope asks into a
    SINGLE digest email, instead of one email per sync. In-app notifications are
    still created instantly by the sync; this only governs the email cadence."""
    while True:
        try:
            await asyncio.sleep(1800)  # re-check every 30 min
            now_dt = datetime.now(timezone.utc)
            user_ids = await db.notifications.distinct("user_id", {"type": "scope_creep", "digested": False})
            for uid in user_ids:
                user = await db.users.find_one(
                    {"user_id": uid}, {"_id": 0, "email": 1, "name": 1, "last_scope_digest_at": 1}
                )
                if not user or not user.get("email"):
                    continue
                last = user.get("last_scope_digest_at")
                if last:
                    try:
                        if (now_dt - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() < 86400:
                            continue
                    except Exception:
                        pass
                pending = await db.notifications.find(
                    {"user_id": uid, "type": "scope_creep", "digested": False}, {"_id": 0}
                ).sort("created_at", 1).to_list(length=200)
                if not pending:
                    continue
                groups = {}
                for n in pending:
                    g = groups.setdefault(n.get("project_id"), {
                        "project_name": n.get("project_name") or "your project",
                        "project_id": n.get("project_id"), "items": [],
                    })
                    g["items"].append({"title": n.get("title", ""), "detail": n.get("detail", "")})
                ok = False
                try:
                    ok = await send_scope_digest(
                        owner_email=user["email"], owner_name=user.get("name", ""),
                        groups=list(groups.values()), public_base_url=PUBLIC_BASE,
                    )
                except Exception as e:
                    logger.warning("scope digest send failed for %s: %s", uid, e)
                # Always advance the 24h clock; only clear the queue once sent, so
                # a delivery failure simply rolls into tomorrow's digest.
                await db.users.update_one({"user_id": uid}, {"$set": {"last_scope_digest_at": _now_iso()}})
                if ok:
                    await db.notifications.update_many(
                        {"user_id": uid, "type": "scope_creep", "digested": False},
                        {"$set": {"digested": True}},
                    )
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.warning("scope digest loop iteration failed: %s", e)
