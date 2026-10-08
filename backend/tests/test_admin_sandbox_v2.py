"""Admin panel auth + metrics and sandbox lock rules (backend/admin_v2.py,
backend/sandbox_v2.py). Runs against an in-memory Mongo (mongomock-motor).

    cd backend && .venv/Scripts/python -m pytest tests/test_admin_sandbox_v2.py -q
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bracket_test")
os.environ.setdefault("CONNECT_TOKEN_KEY", "Gq3ixA0Yw0nq1yC5u8m0Cq0vB6cY8p3w1kQ2r4s5t6U=")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The AI layer's private SDK isn't installable here; nothing below calls it.
from unittest.mock import MagicMock  # noqa: E402
for _m in ("emergentintegrations", "emergentintegrations.llm", "emergentintegrations.llm.chat", "emergentintegrations.payments", "emergentintegrations.payments.stripe", "emergentintegrations.payments.stripe.checkout"):
    sys.modules.setdefault(_m, MagicMock())

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402
from passlib.hash import bcrypt  # noqa: E402

import admin_v2  # noqa: E402
import sandbox_v2  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture()
def client(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(admin_v2, "db", db)
    monkeypatch.setenv("ADMIN_USERNAME", "owner")
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", bcrypt.using(rounds=4).hash(PASSWORD))
    app = FastAPI()
    admin_v2.install(app)
    c = TestClient(app)
    c.db = db
    return c


def login(c, user="owner", pw=PASSWORD):
    return c.post("/api/v2/admin/login", json={"username": user, "password": pw})


def test_requires_session(client):
    r = client.get("/api/v2/admin/overview")
    assert r.status_code == 401
    assert r.json()["code"] == "admin_session"


def test_login_sets_scoped_httponly_cookie(client):
    r = login(client)
    assert r.status_code == 200, r.text
    cookie = r.headers["set-cookie"]
    assert "bk_admin=" in cookie and "HttpOnly" in cookie and "Path=/api/v2/admin" in cookie
    assert "samesite=strict" in cookie.lower()
    assert client.get("/api/v2/admin/session").json()["username"] == "owner"


def test_wrong_password_counts_down_then_pauses(client):
    for left in (4, 3, 2, 1):
        r = login(client, pw="nope")
        assert r.status_code == 401 and r.json()["attempts_left"] == left
    r = login(client, pw="nope")
    assert r.status_code == 429 and r.json()["code"] == "admin_paused"
    # even the right password is refused while paused
    assert login(client).status_code == 429


def test_wrong_username_is_rejected(client):
    assert login(client, user="admin").status_code == 401


def test_unconfigured_server_refuses_everyone(client, monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD_HASH")
    assert login(client).status_code == 401


def test_logout_ends_session(client):
    login(client)
    assert client.post("/api/v2/admin/logout").status_code == 200
    assert client.get("/api/v2/admin/session").status_code == 401


def _seed_users(db):
    now = datetime.now(timezone.utc)
    import asyncio
    docs = [
        {"user_id": "u_trial", "email": "t@x.com", "name": "Trial Person", "created_at": (now - timedelta(days=3)).isoformat(), "last_seen_at": now.isoformat()},
        {"user_id": "u_paid", "email": "p@x.com", "name": "Paid Person", "plan": "monthly", "plan_currency": "inr", "plan_since": (now - timedelta(days=40)).isoformat(), "created_at": (now - timedelta(days=60)).isoformat(), "last_seen_at": now.isoformat()},
        {"user_id": "u_old", "email": "o@x.com", "name": "Old Person", "created_at": (now - timedelta(days=90)).isoformat()},
        {"user_id": "g1", "email": "g@sandbox.invalid", "is_sandbox": True, "created_at": now.isoformat()},
    ]
    asyncio.get_event_loop().run_until_complete(db.users.insert_many(docs))


def test_metrics_and_users(client):
    _seed_users(client.db)
    login(client)
    o = client.get("/api/v2/admin/overview?range=30&currency=inr").json()
    assert o["kpis"]["signups"]["value"] == 1  # sandbox guests never count
    assert o["kpis"]["paying"]["monthly"] == 1
    assert o["kpis"]["mrr"]["value"] == 999
    u = client.get("/api/v2/admin/users?status=trial").json()
    assert u["counts"] == {"all": 3, "trial": 1, "paying": 1, "past_due": 0, "canceled": 0, "expired": 1, "suspended": 0}
    assert [x["id"] for x in u["users"]] == ["u_trial"]
    assert "password_hash" not in str(u)


def test_extend_trial_and_suspend_are_audited(client):
    _seed_users(client.db)
    login(client)
    assert client.post("/api/v2/admin/users/u_trial/extend-trial", json={"days": 7, "reason": ""}).status_code == 422
    r = client.post("/api/v2/admin/users/u_trial/extend-trial", json={"days": 7, "reason": "call ran late", "notify": False})
    assert r.status_code == 200, r.text
    assert client.post("/api/v2/admin/users/u_paid/extend-trial", json={"days": 7, "reason": "x"}).status_code == 409
    assert client.post("/api/v2/admin/users/u_trial/suspend", json={"reason": "abuse"}).status_code == 200
    assert client.get("/api/v2/admin/users?status=suspended").json()["total"] == 1
    actions = [a["action"] for a in client.get("/api/v2/admin/audit").json()["items"]]
    assert {"sign_in", "extend_trial", "suspend"} <= set(actions)


@pytest.mark.parametrize("method,path,action", [
    ("POST", "/api/v2/w/p1/sources/connect", "connect"),
    ("POST", "/api/v2/w/p1/threads/t1/send", "send"),
    ("POST", "/api/v2/w/p1/members/invite", "invite"),
    ("POST", "/api/v2/billing/checkout", "billing"),
    ("POST", "/api/payments/razorpay/order", "billing"),
    ("DELETE", "/api/v2/me", "account"),
    ("POST", "/api/v2/w/p1/files", "upload"),
])
def test_sandbox_locks_account_actions(method, path, action):
    assert sandbox_v2.lock_for(method, path) == action


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/v2/w/p1/reviews/r1/accept"),
    ("POST", "/api/v2/w/p1/ask"),
    ("GET", "/api/v2/w/p1/sources"),
    ("POST", "/api/v2/w/p1/threads/t1/draft"),
    ("POST", "/api/v2/sandbox/next"),
])
def test_sandbox_allows_exploring(method, path):
    assert sandbox_v2.lock_for(method, path) is None
