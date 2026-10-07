"""Iteration 38 — Change Digest, Notifications, Cross-Source Ask, Connection Health.

Endpoints under test:
- GET  /api/connect/digest?window=24h|7d
- GET  /api/notifications
- POST /api/notifications/read
- POST /api/ask/all
- POST /api/projects/all/ask   (alias)
- GET  /api/projects/{id}/connections (health object attached)
"""
import os
import pytest
import requests
from pymongo import MongoClient


def _read_frontend_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", _read_frontend_env()).rstrip("/")
DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"

mongo = MongoClient("mongodb://localhost:27017")
db = mongo["bracket_db"]

CATS = {"decision", "deadline", "scope_change", "requirement", "deliverable", "question"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def demo_user_id():
    u = db.users.find_one({"email": DEMO_EMAIL})
    assert u
    return u.get("user_id") or u.get("id")


@pytest.fixture(scope="module", autouse=True)
def _reset_notifications_read_state(demo_user_id):
    """Ensure the seed scope_creep notif is unread at the start of the run."""
    db.notifications.update_many({"user_id": demo_user_id}, {"$set": {"read": False}})
    yield


class TestChangeDigest:
    def test_digest_24h_shape(self, session):
        r = session.get(f"{BASE_URL}/api/connect/digest", params={"window": "24h"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["window"] == "24h"
        assert isinstance(d["counts"], dict)
        assert set(d["counts"].keys()) == CATS
        assert isinstance(d["items"], list)
        assert isinstance(d["total"], int)
        assert isinstance(d["projects_with_changes"], int)
        assert isinstance(d["scope_alerts"], int)
        assert d["total"] == sum(d["counts"].values())

    def test_digest_7d_shape(self, session):
        r = session.get(f"{BASE_URL}/api/connect/digest", params={"window": "7d"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["window"] == "7d"
        assert set(d["counts"].keys()) == CATS
        # 7d should be >= 24h
        r24 = session.get(f"{BASE_URL}/api/connect/digest", params={"window": "24h"}, timeout=15).json()
        assert d["total"] >= r24["total"]

    def test_digest_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/connect/digest", timeout=15)
        assert r.status_code == 401


class TestNotifications:
    def test_list_returns_seed_and_unread(self, session):
        r = session.get(f"{BASE_URL}/api/notifications", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "unread" in d
        assert isinstance(d["items"], list)
        assert d["unread"] >= 1
        # seed scope_creep notif must be present
        assert any(n.get("type") == "scope_creep" for n in d["items"])

    def test_mark_all_read(self, session):
        r = session.post(f"{BASE_URL}/api/notifications/read", json={}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        # unread should now be 0
        r2 = session.get(f"{BASE_URL}/api/notifications", timeout=15).json()
        assert r2["unread"] == 0

    def test_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/notifications", timeout=15).status_code == 401
        assert requests.post(f"{BASE_URL}/api/notifications/read", json={}, timeout=15).status_code == 401


class TestCrossSourceAsk:
    QUESTION = "What client requests should I worry about?"

    def test_ask_all(self, session):
        r = session.post(f"{BASE_URL}/api/ask/all",
                         json={"question": self.QUESTION}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "sources" in d
        assert isinstance(d["sources"], list)
        assert len(d["sources"]) >= 1
        ans = d.get("answer") or d.get("text") or ""
        assert len(str(ans)) > 5

    def test_projects_all_ask_alias(self, session):
        r = session.post(f"{BASE_URL}/api/projects/all/ask",
                         json={"question": self.QUESTION}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "sources" in d
        assert len(d["sources"]) >= 1

    def test_requires_auth(self):
        # Body is valid so we exercise auth branch (not FastAPI 422).
        r = requests.post(f"{BASE_URL}/api/ask/all",
                          json={"question": "test question"}, timeout=30)
        assert r.status_code == 401


class TestConnectionHealth:
    def test_connections_have_health(self, session, demo_user_id):
        # Find a project that has at least one connection for this user
        pids = [p["id"] for p in db.projects.find({"owner_user_id": demo_user_id}, {"_id": 0, "id": 1})]
        conn = db.source_connections.find_one({"project_id": {"$in": pids}}, {"_id": 0, "project_id": 1})
        if not conn:
            pytest.skip("no source_connections seeded for demo user; UI/backend health path still valid")
        pid = conn["project_id"]
        r = session.get(f"{BASE_URL}/api/projects/{pid}/connections", timeout=15)
        assert r.status_code == 200, r.text
        conns = r.json()["connections"]
        assert conns
        for c in conns:
            assert "health" in c
            h = c["health"]
            assert h["level"] in {"green", "amber", "red"}
            assert "state" in h and "message" in h
            assert "days_left" in h and "expires_at" in h
