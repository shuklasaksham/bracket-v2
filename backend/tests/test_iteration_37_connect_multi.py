"""Iteration 37 — Connect Work multi-source rewrite backend tests.

Covers:
- Providers directory (setup_required / coming_soon, multi flag)
- auth-url unconfigured (400) + 401 without session
- Figma OAuth activation smoke (env-append client_id/secret, restart)
- Multi-source seeded preview → establish → 2 connections, 3 memory items, 2 events
- Duplicate detection (409), Ask Bracket, memory actions, disconnect
"""
import os
import subprocess
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
BACKEND_ENV_PATH = "/app/backend/.env"
FIG_LINES = ["FIGMA_CLIENT_ID=test-client-id\n", "FIGMA_CLIENT_SECRET=test-secret\n"]

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


# --------- shared session ---------------------------------------------------
@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def demo_user_id():
    u = db.users.find_one({"email": DEMO_EMAIL})
    assert u
    return u.get("user_id") or u.get("id")


# --------- helpers ----------------------------------------------------------
def _restart_backend():
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, timeout=60)
    # wait until API responds
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/api/connect/providers", timeout=5)
            if r.status_code in (200, 401):
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("backend did not come back up")


def _append_figma_env():
    with open(BACKEND_ENV_PATH, "a") as f:
        for ln in FIG_LINES:
            f.write(ln)


def _remove_figma_env():
    with open(BACKEND_ENV_PATH) as f:
        content = f.read()
    for ln in FIG_LINES:
        content = content.replace(ln, "")
    with open(BACKEND_ENV_PATH, "w") as f:
        f.write(content)


# ===== 1. Providers directory ==============================================
class TestProviders:
    def test_unauthorized(self):
        r = requests.get(f"{BASE_URL}/api/connect/providers", timeout=15)
        assert r.status_code == 401

    def test_providers_statuses(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/connect/providers", timeout=15)
        assert r.status_code == 200
        data = r.json()
        by_key = {p["key"]: p for p in data["providers"]}
        for k in ("gmail", "slack", "figma", "github", "notion"):
            assert by_key[k]["status"] == "setup_required", f"{k} should be setup_required, got {by_key[k]['status']}"
            assert by_key[k]["multi"] is True
        for k in ("whatsapp", "teams", "gdrive", "dropbox", "adobe", "linear"):
            assert by_key[k]["status"] == "coming_soon", f"{k} should be coming_soon"
        assert data["categories"] == ["Communication", "Design", "Files & Knowledge", "Development"]


# ===== 2. auth-url errors for unconfigured providers =======================
class TestAuthUrlUnconfigured:
    @pytest.mark.parametrize("provider", ["figma", "gmail", "slack", "github", "notion"])
    def test_setup_required_400(self, demo_session, provider):
        r = demo_session.get(f"{BASE_URL}/api/connect/{provider}/auth-url", timeout=15)
        assert r.status_code == 400
        detail = (r.json().get("detail") or "").lower()
        assert "admin" in detail and "credential" in detail

    def test_auth_url_requires_session(self):
        r = requests.get(f"{BASE_URL}/api/connect/figma/auth-url", timeout=15)
        assert r.status_code == 401


# ===== 3. Figma OAuth activation smoke =====================================
class TestFigmaActivation:
    def test_activate_and_deactivate(self, demo_session):
        try:
            _append_figma_env()
            _restart_backend()
            # need new session because backend restarted
            s = requests.Session()
            r = s.post(f"{BASE_URL}/api/auth/login",
                       json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
            assert r.status_code == 200

            provs = s.get(f"{BASE_URL}/api/connect/providers", timeout=15).json()
            figma = next(p for p in provs["providers"] if p["key"] == "figma")
            assert figma["status"] == "available", figma

            au = s.get(f"{BASE_URL}/api/connect/figma/auth-url", timeout=15)
            assert au.status_code == 200
            url = au.json()["url"]
            assert url.startswith("https://www.figma.com/oauth")
            assert "client_id=test-client-id" in url
            assert "%2Fapi%2Fconnect%2Ffigma%2Fcallback" in url or "/api/connect/figma/callback" in url
            assert "scope=file_read" in url
            assert "state=" in url

            cb = s.get(f"{BASE_URL}/api/connect/figma/callback",
                       params={"code": "x", "state": "bogus"}, timeout=15,
                       allow_redirects=False)
            assert cb.status_code == 400
            assert "text/html" in cb.headers.get("content-type", "").lower()
        finally:
            _remove_figma_env()
            _restart_backend()
            # verify back to setup_required
            s2 = requests.Session()
            s2.post(f"{BASE_URL}/api/auth/login",
                    json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
            provs = s2.get(f"{BASE_URL}/api/connect/providers", timeout=15).json()
            figma = next(p for p in provs["providers"] if p["key"] == "figma")
            assert figma["status"] == "setup_required", f"figma not restored: {figma}"


# ===== 4. Multi-source pipeline via seeded preview =========================
SEEDED_PREVIEW = {"id": None, "project_id": None}


@pytest.fixture(scope="module")
def seeded_preview(demo_user_id):
    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "user_id": demo_user_id, "provider": "github",
        "items": [
            {"source": {"id": "acme/website", "name": "acme/website", "url": "https://github.com/acme/website"},
             "digest": "GITHUB REPO: acme/website\nISSUES:\n- [open] #12 Add testimonials (client request)\n- [closed] #8 Homepage hero approved",
             "analysis": {
                 "project": {"name": "Acme Website Redesign", "client": "Acme Corp", "description": "Site redesign."},
                 "requirements": [{"title": "Testimonials section", "detail": "requested", "status": "detected"}],
                 "decisions": [{"title": "Hero approved", "detail": "client approved", "status": "confirmed"}],
                 "deliverables": [], "deadlines": [], "open_questions": [],
                 "match": {"project_id": None, "confidence": 0, "reason": ""}}},
            {"source": {"id": "acme/api", "name": "acme/api", "url": "https://github.com/acme/api"},
             "digest": "GITHUB REPO: acme/api\nREADME: Backend API for Acme site",
             "analysis": {
                 "project": {"name": "Acme Website Redesign", "client": "Acme Corp", "description": ""},
                 "requirements": [{"title": "API rate limiting", "detail": "mentioned in readme", "status": "detected"}],
                 "decisions": [], "deliverables": [], "deadlines": [], "open_questions": [],
                 "match": {"project_id": None, "confidence": 0, "reason": ""}}},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.connect_previews.insert_one(doc)
    yield pid
    # cleanup happens in TestCleanup below


class TestMultiSourcePipeline:
    def test_establish_new_project(self, demo_session, seeded_preview):
        r = demo_session.post(f"{BASE_URL}/api/connect/establish",
                              json={"preview_id": seeded_preview, "mode": "new"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["project_id"]
        assert len(d["connection_ids"]) == 2
        assert d["memory_count"] == 3  # 2 requirements + 1 decision
        SEEDED_PREVIEW["project_id"] = d["project_id"]

    def test_connections_endpoint(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/connections", timeout=15)
        assert r.status_code == 200
        conns = r.json()["connections"]
        assert len(conns) == 2
        assert all(c["provider"] == "github" for c in conns)
        source_ids = sorted(c["source_id"] for c in conns)
        assert source_ids == ["acme/api", "acme/website"]

    def test_memory_endpoint(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 3
        labels = {i["source_label"] for i in items}
        assert labels == {"acme/website", "acme/api"}
        # each item has a source_label matching its source
        for i in items:
            assert i["source_label"] in ("acme/website", "acme/api")
            assert i["provider"] == "github"

    def test_activity_endpoint(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        r = demo_session.get(f"{BASE_URL}/api/projects/{pid}/activity", timeout=15)
        assert r.status_code == 200
        events = r.json()["events"]
        connected_events = [e for e in events if e["event_type"] == "SOURCE_CONNECTED"]
        assert len(connected_events) == 2

    def test_duplicate_establish_409(self, demo_session, demo_user_id):
        pid_project = SEEDED_PREVIEW["project_id"]
        # Re-seed a preview with same sources targeting existing project
        pid = str(uuid.uuid4())
        db.connect_previews.insert_one({
            "id": pid, "user_id": demo_user_id, "provider": "github",
            "items": [
                {"source": {"id": "acme/website", "name": "acme/website", "url": ""},
                 "digest": "GITHUB REPO: acme/website\nISSUES: same",
                 "analysis": {"project": {"name": "Acme"}, "requirements": [], "decisions": [],
                              "deliverables": [], "deadlines": [], "open_questions": [],
                              "match": {"project_id": None, "confidence": 0, "reason": ""}}},
                {"source": {"id": "acme/api", "name": "acme/api", "url": ""},
                 "digest": "GITHUB REPO: acme/api",
                 "analysis": {"project": {"name": "Acme"}, "requirements": [], "decisions": [],
                              "deliverables": [], "deadlines": [], "open_questions": [],
                              "match": {"project_id": None, "confidence": 0, "reason": ""}}},
            ],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = demo_session.post(f"{BASE_URL}/api/connect/establish",
                              json={"preview_id": pid, "mode": "existing", "project_id": pid_project},
                              timeout=30)
        assert r.status_code == 409, r.text

    def test_ask_bracket(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        r = demo_session.post(f"{BASE_URL}/api/projects/{pid}/ask",
                              json={"question": "Was the hero approved?"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "sources" in d
        # answer should be non-empty text
        ans = d.get("answer") or d.get("text") or ""
        assert len(str(ans)) > 5

    def test_memory_confirm_and_ignore(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        items = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory").json()["items"]
        assert items
        r1 = demo_session.post(f"{BASE_URL}/api/connect/memory/{items[0]['id']}/action",
                               json={"action": "confirm"}, timeout=15)
        assert r1.status_code == 200
        assert r1.json()["status"] == "confirmed"
        r2 = demo_session.post(f"{BASE_URL}/api/connect/memory/{items[1]['id']}/action",
                               json={"action": "ignore"}, timeout=15)
        assert r2.status_code == 200
        # ignored items should disappear from listing
        remaining = demo_session.get(f"{BASE_URL}/api/projects/{pid}/memory").json()["items"]
        assert not any(i["id"] == items[1]["id"] for i in remaining)

    def test_disconnect_one(self, demo_session):
        pid = SEEDED_PREVIEW["project_id"]
        conns = demo_session.get(f"{BASE_URL}/api/projects/{pid}/connections").json()["connections"]
        assert len(conns) == 2
        target = conns[0]
        r = demo_session.delete(f"{BASE_URL}/api/connect/connections/{target['id']}", timeout=15)
        assert r.status_code == 200
        remaining = demo_session.get(f"{BASE_URL}/api/projects/{pid}/connections").json()["connections"]
        assert len(remaining) == 1
        assert remaining[0]["id"] != target["id"]
        events = demo_session.get(f"{BASE_URL}/api/projects/{pid}/activity").json()["events"]
        assert any(e["event_type"] == "SOURCE_DISCONNECTED" for e in events)


# ===== 5. Cleanup ==========================================================
class TestCleanup:
    def test_cleanup_seeded_data(self, demo_user_id):
        pid = SEEDED_PREVIEW["project_id"]
        if pid:
            db.projects.delete_many({"id": pid})
            db.source_connections.delete_many({"project_id": pid})
            db.project_memory.delete_many({"project_id": pid})
            db.source_events.delete_many({"project_id": pid})
        db.connect_previews.delete_many({"user_id": demo_user_id})
