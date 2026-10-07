"""Iteration 52 — Consolidated Project Update flow + Today's Focus /seen tracking.

Covers:
- POST /api/projects/{id}/update/build  (pending:true w/ summary/priority/impacts/direct/downstream, and pending:false)
- POST /api/projects/{id}/update/{update_id}/approve (confirmed+added, 409 on re-approve, atomicity via GET verify)
- POST /api/projects/{id}/update/{update_id}/reject  (discarded, 409 on re-reject, no downstream inserted)
- POST /api/projects/{id}/seen (previous timestamp, persisted per-account)
- Auth (401 no cookies) + ownership (404 unknown project)
"""
import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
FRONTEND_ENV = "/app/frontend/.env"
with open(FRONTEND_ENV) as fh:
    for line in fh:
        if line.startswith("REACT_APP_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PW = "BracketDemo@2026"
DEMO_PROJECT_ID = "9ea97afb-fb31-4b74-bce0-71a284fdc1eb"
DEMO_OWNER = "user_a76c1e5b34c1"

mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PW},
               timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def initial_pending_ids():
    """Snapshot the IDs of the currently-detected memory items so we can
    restore state between tests without inventing new rows."""
    ids = [m["id"] for m in db.project_memory.find(
        {"project_id": DEMO_PROJECT_ID, "status": {"$in": ["detected", "review"]}},
        {"_id": 0, "id": 1})]
    assert len(ids) >= 3, f"demo project needs pending items to test — found {len(ids)}"
    return ids


def _reset_state(pending_ids):
    """Restore demo memory items to 'detected' and clear any built snapshot
    and any bracket-provider downstream items created by prior approve runs."""
    db.project_memory.update_many(
        {"id": {"$in": pending_ids}},
        {"$set": {"status": "detected"}},
    )
    db.project_updates.delete_many({"project_id": DEMO_PROJECT_ID})
    # Remove any downstream items we might have inserted during approve tests.
    db.project_memory.delete_many(
        {"project_id": DEMO_PROJECT_ID, "provider": "bracket",
         "source_label": "Bracket update"},
    )


# ---------- BUILD ----------
class TestBuild:
    def test_build_returns_full_snapshot(self, session, initial_pending_ids):
        _reset_state(initial_pending_ids)
        r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build",
                         timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("pending") is True
        upd = data.get("update") or {}
        assert isinstance(upd.get("summary"), str) and len(upd["summary"]) > 0
        assert upd.get("priority") in ("low", "medium", "high", "critical")
        assert isinstance(upd.get("impacts"), list) and len(upd["impacts"]) > 0
        # every impact has kind + detail
        for imp in upd["impacts"]:
            assert imp.get("kind") and imp.get("detail")
        # direct items = pending items (>=3)
        assert isinstance(upd.get("direct"), list) and len(upd["direct"]) >= 3
        VISIBLE = {"deliverable", "scope", "timeline", "requirement", "decision", "deadline"}
        for it in upd["direct"]:
            assert it.get("category") in VISIBLE
            assert it.get("title")
        # downstream is present, non-empty, and every item is in visible cats
        assert isinstance(upd.get("downstream"), list) and len(upd["downstream"]) > 0
        for d in upd["downstream"]:
            assert d.get("category") in VISIBLE
            assert d.get("title")
            assert "reason" in d

    def test_build_no_pending_returns_false(self, session, initial_pending_ids):
        # Mark all pending items ignored so nothing is pending.
        _reset_state(initial_pending_ids)
        db.project_memory.update_many(
            {"id": {"$in": initial_pending_ids}}, {"$set": {"status": "ignored"}})
        db.project_updates.delete_many({"project_id": DEMO_PROJECT_ID})
        r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build",
                         timeout=15)
        assert r.status_code == 200
        assert r.json() == {"pending": False}
        # restore for later tests
        _reset_state(initial_pending_ids)


# ---------- APPROVE ----------
class TestApprove:
    def test_approve_flow_and_reapprove_409(self, session, initial_pending_ids):
        _reset_state(initial_pending_ids)
        b = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build",
                         timeout=45)
        upd_id = b.json()["update"]["id"]
        n_direct = len(b.json()["update"]["direct"])
        n_downstream = len(b.json()["update"]["downstream"])

        r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/{upd_id}/approve",
                         timeout=15)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js.get("ok") is True
        assert js.get("confirmed") == n_direct
        assert js.get("added") == n_downstream

        # verify persistence: pending IDs are now confirmed
        confirmed_after = db.project_memory.count_documents(
            {"id": {"$in": initial_pending_ids}, "status": "confirmed"})
        assert confirmed_after == len(initial_pending_ids)
        # downstream items present with provider=bracket
        bracket_added = db.project_memory.count_documents(
            {"project_id": DEMO_PROJECT_ID, "provider": "bracket",
             "source_label": "Bracket update"})
        assert bracket_added == n_downstream

        # re-approve is 409
        r2 = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/{upd_id}/approve",
                          timeout=15)
        assert r2.status_code == 409

        _reset_state(initial_pending_ids)


# ---------- REJECT ----------
class TestReject:
    def test_reject_flow_and_rereject_409(self, session, initial_pending_ids):
        _reset_state(initial_pending_ids)
        b = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build",
                         timeout=45)
        upd_id = b.json()["update"]["id"]
        n_direct = len(b.json()["update"]["direct"])

        r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/{upd_id}/reject",
                         timeout=15)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js.get("ok") is True
        assert js.get("discarded") == n_direct

        # verify: items now ignored, no new bracket downstream rows created
        ignored_after = db.project_memory.count_documents(
            {"id": {"$in": initial_pending_ids}, "status": "ignored"})
        assert ignored_after == len(initial_pending_ids)
        bracket_added = db.project_memory.count_documents(
            {"project_id": DEMO_PROJECT_ID, "provider": "bracket",
             "source_label": "Bracket update"})
        assert bracket_added == 0

        # re-reject is 409
        r2 = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/{upd_id}/reject",
                          timeout=15)
        assert r2.status_code == 409

        _reset_state(initial_pending_ids)


# ---------- SEEN ----------
class TestSeen:
    def test_seen_returns_previous_and_persists(self, session):
        # First call: capture previous
        r1 = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/seen", timeout=10)
        assert r1.status_code == 200
        prev1 = r1.json().get("previous")
        # Second call must return the timestamp that first call just wrote
        time.sleep(0.4)
        r2 = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/seen", timeout=10)
        assert r2.status_code == 200
        prev2 = r2.json().get("previous")
        assert prev2 is not None
        # prev2 was written by call #1, so it must be strictly greater than prev1 (or prev1 was null)
        assert prev1 is None or prev2 > prev1


# ---------- AUTH / OWNERSHIP ----------
class TestAuthAndOwnership:
    def test_build_requires_auth(self):
        anon = requests.Session()
        r = anon.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build", timeout=10)
        assert r.status_code in (401, 403)

    def test_seen_requires_auth(self):
        anon = requests.Session()
        r = anon.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/seen", timeout=10)
        assert r.status_code in (401, 403)

    def test_unknown_project_404(self, session):
        fake = str(uuid.uuid4())
        r = session.post(f"{BASE_URL}/api/projects/{fake}/update/build", timeout=10)
        assert r.status_code == 404
        r = session.post(f"{BASE_URL}/api/projects/{fake}/seen", timeout=10)
        assert r.status_code == 404
        r = session.post(f"{BASE_URL}/api/projects/{fake}/update/{uuid.uuid4()}/approve", timeout=10)
        assert r.status_code == 404
        r = session.post(f"{BASE_URL}/api/projects/{fake}/update/{uuid.uuid4()}/reject", timeout=10)
        assert r.status_code == 404

    def test_not_owner_forbidden(self, session, initial_pending_ids):
        """Temporarily reassign the project owner so the demo user is NOT the
        owner, then confirm every endpoint returns 403. Restore afterward."""
        _reset_state(initial_pending_ids)
        try:
            db.projects.update_one(
                {"id": DEMO_PROJECT_ID},
                {"$set": {"owner_user_id": "someone_else"}})
            r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/build", timeout=10)
            assert r.status_code == 403
            r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/seen", timeout=10)
            assert r.status_code == 403
            r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/xxx/approve", timeout=10)
            assert r.status_code == 403
            r = session.post(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/update/xxx/reject", timeout=10)
            assert r.status_code == 403
        finally:
            db.projects.update_one(
                {"id": DEMO_PROJECT_ID},
                {"$set": {"owner_user_id": DEMO_OWNER}})
            _reset_state(initial_pending_ids)
