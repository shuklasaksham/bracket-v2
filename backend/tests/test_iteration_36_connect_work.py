"""Iteration 36 — Connect Work end-to-end backend tests.

Covers the Connect Work pipeline: providers directory, real token
validation (Figma/GitHub/Notion with garbage tokens expecting 400),
DB-seeded preview → establish → project/connections/memory/activity,
memory actions, Ask Bracket (real Claude Haiku), sync (no account →
needs_attention), disconnect, and auth boundaries.
"""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

def _read_frontend_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", _read_frontend_env()).rstrip("/")
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "bracket_db"

DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


# --------- fixtures ---------------------------------------------------------
@pytest.fixture(scope="session")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def demo_user_id():
    u = db.users.find_one({"email": DEMO_EMAIL}, {"_id": 0, "id": 1, "user_id": 1})
    assert u, "demo user not seeded"
    return u.get("user_id") or u.get("id")


@pytest.fixture(scope="session")
def other_session():
    """Create a second OTP user for cross-user auth boundary tests."""
    email = f"e2e+iter36+{uuid.uuid4().hex[:6]}@example.com"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/request", json={"email": email}, timeout=30)
    assert r.status_code == 200, r.text
    code = r.json().get("dev_code")
    assert code, f"OTP_TEST_MODE not returning dev_code: {r.json()}"
    r2 = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": email, "code": code}, timeout=30)
    assert r2.status_code == 200, r2.text
    return s, email


# --------- providers directory ---------------------------------------------
class TestProviders:
    def test_unauthenticated_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/connect/providers", timeout=15)
        assert r.status_code == 401, r.status_code

    def test_providers_list_shape(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/connect/providers", timeout=15)
        assert r.status_code == 200
        data = r.json()
        provs = data.get("providers") or []
        keys = {p["key"]: p for p in provs}
        assert len(provs) == 11, f"expected 11 providers, got {len(provs)}"
        # Honest statuses
        for k in ("figma", "github", "notion"):
            # If an account is already saved from an earlier run it could be
            # 'connected' — treat that as fine.
            assert keys[k]["status"] in ("available", "connected"), (k, keys[k]["status"])
        assert keys["gmail"]["status"] == "setup_required"
        for k in ("slack", "whatsapp", "teams", "adobe", "gdrive", "dropbox", "linear"):
            assert keys[k]["status"] == "coming_soon", (k, keys[k]["status"])
        assert data.get("categories")


# --------- real token validation -------------------------------------------
class TestTokenValidation:
    @pytest.mark.parametrize("provider", ["figma", "github", "notion"])
    def test_garbage_token_rejected(self, demo_session, provider):
        r = demo_session.post(
            f"{BASE_URL}/api/connect/accounts",
            json={"provider": provider, "token": "definitely-not-a-real-token-xyz123"},
            timeout=45,
        )
        assert r.status_code == 400, f"{provider}: {r.status_code} {r.text}"
        # Ensure NOT persisted
        acc = db.integration_accounts.find_one({"user_id": _demo_uid(), "provider": provider})
        assert acc is None, f"{provider} account should not be saved after invalid token"


def _demo_uid():
    u = db.users.find_one({"email": DEMO_EMAIL}, {"_id": 0, "id": 1, "user_id": 1})
    return u.get("user_id") or u.get("id")


# --------- Pipeline via seeded preview -------------------------------------
SEED_STATE = {}


@pytest.fixture(scope="session")
def seeded_preview(demo_user_id):
    """Seed a connect_previews doc directly per the review request."""
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "user_id": demo_user_id,
        "provider": "github",
        "source_id": "acme/website",
        "source_name": "acme/website",
        "source_url": "https://github.com/acme/website",
        "digest": (
            "GITHUB REPO: acme/website\n"
            "Description: Marketing site redesign for Acme Corp\n"
            "ISSUES:\n"
            "- [open] #12 Add testimonials section (client request)\n"
            "- [closed] #8 Homepage hero approved by client\n"
            "RECENT COMMITS:\n"
            "- 2026-08-01: homepage hero final"
        ),
        "analysis": {
            "project": {
                "name": "TEST Acme Website Redesign",
                "client": "Acme Corp",
                "description": "Website redesign based on the connected repo.",
            },
            "requirements": [
                {"title": "Testimonials section", "detail": "Client requested testimonials", "status": "detected"},
            ],
            "decisions": [
                {"title": "Homepage hero approved", "detail": "Client approved the hero", "status": "confirmed"},
            ],
            "deliverables": [
                {"title": "Homepage", "detail": "", "status": "confirmed"},
            ],
            "deadlines": [],
            "open_questions": [],
            "match": {"project_id": None, "confidence": 0, "reason": ""},
        },
        "created_at": "2026-08-10T00:00:00+00:00",
    }
    db.connect_previews.insert_one(doc)
    yield pid
    # cleanup (in case establish didn't consume it)
    db.connect_previews.delete_one({"id": pid})


class TestEstablishPipeline:
    def test_establish_new_project(self, demo_session, seeded_preview):
        r = demo_session.post(
            f"{BASE_URL}/api/connect/establish",
            json={"preview_id": seeded_preview, "mode": "new"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("project_id")
        assert data.get("memory_count") == 3, data
        SEED_STATE["project_id"] = data["project_id"]
        SEED_STATE["connection_id"] = data["connection_id"]

    def test_project_created(self, demo_session):
        pid = SEED_STATE["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("name") == "TEST Acme Website Redesign"
        assert p.get("status") == "in_progress"
        assert (p.get("situation_input") or {}).get("raw_paste")

    def test_connections_returns_one(self, demo_session):
        pid = SEED_STATE["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/connections", timeout=15)
        assert r.status_code == 200
        conns = r.json().get("connections") or []
        assert len(conns) == 1
        assert conns[0]["provider"] == "github"
        assert conns[0]["status"] == "connected"

    def test_memory_returns_three(self, demo_session):
        pid = SEED_STATE["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items") or []
        assert len(items) == 3
        statuses = {i["title"]: i["status"] for i in items}
        # From seed: Testimonials=detected, Homepage hero approved=confirmed, Homepage=confirmed
        assert statuses.get("Testimonials section") == "detected"
        assert statuses.get("Homepage hero approved") == "confirmed"
        SEED_STATE["memory_items"] = items

    def test_activity_has_source_connected(self, demo_session):
        pid = SEED_STATE["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/activity", timeout=15)
        assert r.status_code == 200
        events = r.json().get("events") or []
        assert any(e.get("event_type") == "SOURCE_CONNECTED" for e in events)


# --------- Memory actions ---------------------------------------------------
class TestMemoryActions:
    def test_confirm_detected(self, demo_session):
        items = SEED_STATE["memory_items"]
        target = next(i for i in items if i["title"] == "Testimonials section")
        r = demo_session.post(
            f"{BASE_URL}/api/connect/memory/{target['id']}/action",
            json={"action": "confirm"}, timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("status") == "confirmed"
        # Verify persisted
        pid = SEED_STATE["project_id"]
        r2 = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=15)
        it = next((x for x in r2.json()["items"] if x["id"] == target["id"]), None)
        assert it and it["status"] == "confirmed"

    def test_ignore_removes_from_memory(self, demo_session):
        items = SEED_STATE["memory_items"]
        target = next(i for i in items if i["title"] == "Homepage")
        r = demo_session.post(
            f"{BASE_URL}/api/connect/memory/{target['id']}/action",
            json={"action": "ignore"}, timeout=15,
        )
        assert r.status_code == 200
        pid = SEED_STATE["project_id"]
        r2 = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=15)
        titles = [x["id"] for x in r2.json()["items"]]
        assert target["id"] not in titles


# --------- Ask Bracket (real AI, allow 60s) --------------------------------
class TestAskBracket:
    def test_ask_grounded_answer(self, demo_session):
        pid = SEED_STATE["project_id"]
        r = demo_session.post(
            f"{BASE_URL}/api/projects/{pid}/ask",
            json={"question": "Did the client approve the homepage?"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Expect an answer + sources referencing github
        ans = (data.get("answer") or "").lower()
        assert len(ans) > 5, data
        assert "approv" in ans or "yes" in ans, ans
        sources = data.get("sources") or []
        assert any("github" in str(s).lower() or "acme/website" in str(s).lower() for s in sources), sources

    def test_ask_without_connections_returns_422(self, demo_session):
        # Create a fresh project with no connections
        r = demo_session.post(f"{BASE_URL}/api/projects", json={"project_name": "TEST_no_sources"}, timeout=30)
        # Project create endpoint may differ; try common shapes
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot create bare project for negative ask test: {r.status_code} {r.text[:200]}")
        proj_id = r.json().get("id") or r.json().get("project_id")
        assert proj_id
        SEED_STATE["bare_project_id"] = proj_id
        r2 = demo_session.post(
            f"{BASE_URL}/api/projects/{proj_id}/ask",
            json={"question": "Anything?"}, timeout=30,
        )
        assert r2.status_code == 422, r2.text


# --------- Sync (no account -> needs_attention) ----------------------------
class TestSync:
    def test_sync_no_account_needs_attention(self, demo_session):
        cid = SEED_STATE["connection_id"]
        # Ensure no github integration_account exists for demo user
        db.integration_accounts.delete_many({"user_id": _demo_uid(), "provider": "github"})
        r = demo_session.post(f"{BASE_URL}/api/connect/connections/{cid}/sync", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "needs_attention"
        assert data.get("changed") is False


# --------- Disconnect ------------------------------------------------------
class TestDisconnect:
    def test_disconnect_flow(self, demo_session):
        pid = SEED_STATE["project_id"]
        cid = SEED_STATE["connection_id"]
        r = demo_session.delete(f"{BASE_URL}/api/connect/connections/{cid}", timeout=15)
        assert r.status_code == 200
        # Not in active connections
        r2 = demo_session.get(f"{BASE_URL}/api/projects/{pid}/connections", timeout=15)
        conns = r2.json().get("connections") or []
        assert all(c["id"] != cid for c in conns)
        # SOURCE_DISCONNECTED activity event
        r3 = demo_session.get(f"{BASE_URL}/api/projects/{pid}/activity", timeout=15)
        events = r3.json().get("events") or []
        assert any(e.get("event_type") == "SOURCE_DISCONNECTED" for e in events)


# --------- Auth boundaries -------------------------------------------------
class TestAuthBoundaries:
    def test_establish_other_users_preview_404(self, other_session, demo_user_id):
        # Insert a preview owned by demo user
        pid = str(uuid.uuid4())
        db.connect_previews.insert_one({
            "id": pid, "user_id": demo_user_id, "provider": "github",
            "source_id": "x/y", "source_name": "x/y", "source_url": "",
            "digest": "z" * 100, "analysis": {"project": {"name": "TEST_boundary"}},
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        try:
            sess, _ = other_session
            r = sess.post(f"{BASE_URL}/api/connect/establish",
                          json={"preview_id": pid, "mode": "new"}, timeout=30)
            assert r.status_code == 404, r.text
        finally:
            db.connect_previews.delete_one({"id": pid})

    def test_other_users_project_returns_403(self, other_session, demo_session):
        # Create a project under demo
        r = demo_session.post(f"{BASE_URL}/api/projects", json={"project_name": "TEST_boundary_proj"}, timeout=30)
        if r.status_code not in (200, 201):
            pytest.skip("cannot create project for boundary test")
        proj_id = r.json().get("id") or r.json().get("project_id")
        SEED_STATE.setdefault("boundary_project_ids", []).append(proj_id)
        sess, _ = other_session
        for path in ("connections", "memory", "activity"):
            rr = sess.get(f"{BASE_URL}/api/projects/{proj_id}/{path}", timeout=15)
            assert rr.status_code == 403, f"{path}: {rr.status_code} {rr.text}"


# --------- Cleanup ---------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def _cleanup_after_all(demo_session):
    yield
    # Delete created TEST projects and associated data
    try:
        for pid in ({SEED_STATE.get("project_id"), SEED_STATE.get("bare_project_id")} |
                    set(SEED_STATE.get("boundary_project_ids", []) or [])):
            if not pid:
                continue
            db.projects.delete_many({"id": pid})
            db.source_connections.delete_many({"project_id": pid})
            db.project_memory.delete_many({"project_id": pid})
            db.source_events.delete_many({"project_id": pid})
        # Remove any leaked test previews
        db.connect_previews.delete_many({"analysis.project.name": {"$regex": "^TEST"}})
    except Exception as e:
        print(f"cleanup warn: {e}")
