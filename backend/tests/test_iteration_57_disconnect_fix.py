"""Iteration 57 tests — disconnect account removal + gmail OAuth prompt.

Covers:
- DELETE /api/connect/connections/{id} returns account_removed=True when it was
  the LAST active connection for the provider, and False otherwise.
- After a full disconnect, /connect/providers reports status='available' and
  /connect/{provider}/sources returns 400.
- GET /api/connect/gmail/auth-url URL contains prompt=consent+select_account
  (space may be url-encoded as '+' or '%20').
"""
import os
import time
import uuid
from urllib.parse import urlparse, parse_qs

import pytest
import requests
from pymongo import MongoClient

def _env(key: str) -> str:
    v = os.environ.get(key)
    if v:
        return v
    for path in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            for line in open(path).read().splitlines():
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            pass
    raise KeyError(key)


BASE_URL = _env("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = _env("MONGO_URL")
DB_NAME = _env("DB_NAME")

ADMIN_EMAIL = "support@use-bracket.com"
ADMIN_PASSWORD = "Bracket@123"
ADMIN_USER_ID = "user_72246a04c3d2"


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("session_token")
    assert tok, f"no session_token: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    # sanity
    me = s.get(f"{API}/auth/me", timeout=10)
    assert me.status_code == 200
    uid = me.json().get("user_id") or me.json().get("user", {}).get("user_id")
    assert uid == ADMIN_USER_ID, f"expected {ADMIN_USER_ID}, got {uid}: {me.json()}"
    return s


@pytest.fixture()
def seed_project(mongo):
    """Ensure admin owns a test project; return project_id."""
    pid = f"TEST_p_{uuid.uuid4().hex[:10]}"
    now_iso = "2026-01-01T00:00:00Z"
    mongo.projects.insert_one({
        "id": pid, "user_id": ADMIN_USER_ID, "name": "TEST_iter57_project",
        "created_at": now_iso, "updated_at": now_iso,
    })
    yield pid
    mongo.projects.delete_one({"id": pid})
    mongo.source_connections.delete_many({"project_id": pid})


def _seed_connection(mongo, project_id: str, provider: str, active: bool = True):
    cid = f"TEST_c_{uuid.uuid4().hex[:10]}"
    now_iso = "2026-01-01T00:00:00Z"
    mongo.source_connections.insert_one({
        "id": cid, "project_id": project_id, "user_id": ADMIN_USER_ID,
        "provider": provider, "source_type": provider,
        "source_id": f"src_{uuid.uuid4().hex[:6]}", "source_name": f"TEST source {provider}",
        "source_url": "", "status": "connected" if active else "disconnected",
        "content_hash": "", "content_cache": "",
        "extracted_stats": {}, "last_synced_at": now_iso, "last_activity_at": now_iso,
        "created_at": now_iso, "updated_at": now_iso,
    })
    return cid


def _seed_integration_account(mongo, provider: str):
    aid = f"TEST_a_{uuid.uuid4().hex[:10]}"
    mongo.integration_accounts.insert_one({
        "id": aid, "user_id": ADMIN_USER_ID, "provider": provider,
        "label": "test@example.com", "status": "connected",
        "token_enc": "", "created_at": "2026-01-01T00:00:00Z",
    })
    return aid


# ---------- Gmail OAuth prompt ----------

def test_gmail_auth_url_has_prompt_consent_select_account(admin_client):
    r = admin_client.get(f"{API}/connect/gmail/auth-url", timeout=15)
    assert r.status_code == 200, f"auth-url failed: {r.status_code} {r.text}"
    url = r.json().get("url", "")
    assert url, "no url in response"
    # Accept both url-encoded space (+ or %20)
    assert ("prompt=consent+select_account" in url) or ("prompt=consent%20select_account" in url), \
        f"prompt param missing/wrong. url={url}"
    # Also parse & confirm
    qs = parse_qs(urlparse(url).query)
    assert qs.get("prompt", [""])[0] == "consent select_account", f"parsed prompt: {qs.get('prompt')}"


# ---------- Disconnect account_removed = True (last active connection) ----------

def test_disconnect_last_connection_removes_account(admin_client, mongo, seed_project):
    provider = "figma"
    # Clean any leftover account for this provider
    mongo.integration_accounts.delete_many({"user_id": ADMIN_USER_ID, "provider": provider})
    aid = _seed_integration_account(mongo, provider)
    cid = _seed_connection(mongo, seed_project, provider, active=True)

    r = admin_client.delete(f"{API}/connect/connections/{cid}", timeout=15)
    assert r.status_code == 200, f"disconnect failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert body.get("account_removed") is True, f"expected account_removed=True, got {body}"

    # integration_accounts doc for this provider must be gone
    remaining_acc = mongo.integration_accounts.find_one({"user_id": ADMIN_USER_ID, "provider": provider})
    assert remaining_acc is None, f"integration_accounts doc still present: {remaining_acc}"

    # /connect/providers should show provider as 'available' (not 'connected')
    r2 = admin_client.get(f"{API}/connect/providers", timeout=15)
    assert r2.status_code == 200
    providers = {p["key"]: p for p in r2.json().get("providers", [])}
    assert provider in providers, f"provider {provider} missing"
    assert providers[provider]["status"] == "available", f"expected available, got {providers[provider]}"

    # /connect/{provider}/sources should now 400 (which the UI uses to launch OAuth)
    r3 = admin_client.get(f"{API}/connect/{provider}/sources", timeout=15)
    assert r3.status_code == 400, f"expected 400 got {r3.status_code}: {r3.text}"

    # cleanup
    mongo.source_connections.delete_one({"id": cid})


# ---------- Disconnect account_removed = False (other active connections remain) ----------

def test_disconnect_with_other_active_keeps_account(admin_client, mongo, seed_project):
    provider = "github"
    mongo.integration_accounts.delete_many({"user_id": ADMIN_USER_ID, "provider": provider})
    aid = _seed_integration_account(mongo, provider)
    cid_a = _seed_connection(mongo, seed_project, provider, active=True)
    cid_b = _seed_connection(mongo, seed_project, provider, active=True)

    r = admin_client.delete(f"{API}/connect/connections/{cid_a}", timeout=15)
    assert r.status_code == 200, f"disconnect failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("ok") is True
    assert body.get("account_removed") is False, f"expected account_removed=False, got {body}"

    # integration_accounts doc for this provider must still exist
    still = mongo.integration_accounts.find_one({"user_id": ADMIN_USER_ID, "provider": provider, "id": aid})
    assert still is not None, "integration_accounts should still be present"

    # cleanup — second disconnect should now remove account
    r2 = admin_client.delete(f"{API}/connect/connections/{cid_b}", timeout=15)
    assert r2.status_code == 200
    assert r2.json().get("account_removed") is True, "second (last) disconnect should remove account"

    # verify
    assert mongo.integration_accounts.find_one({"user_id": ADMIN_USER_ID, "provider": provider}) is None
    mongo.source_connections.delete_many({"id": {"$in": [cid_a, cid_b]}})


# ---------- Idempotency of provider list after full disconnect ----------

def test_providers_endpoint_available_after_full_disconnect(admin_client, mongo):
    # Make sure no residual test data for slack
    mongo.integration_accounts.delete_many({"user_id": ADMIN_USER_ID, "provider": "slack"})
    mongo.source_connections.delete_many({"user_id": ADMIN_USER_ID, "provider": "slack"})

    r = admin_client.get(f"{API}/connect/providers", timeout=15)
    assert r.status_code == 200
    providers = {p["key"]: p for p in r.json().get("providers", [])}
    assert providers.get("slack", {}).get("status") in ("available", "setup_required", "coming_soon")
