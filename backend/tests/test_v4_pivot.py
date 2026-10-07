"""Regression tests for v4 pivot: dedup, by-email, PDF export, feedback."""
import os
import time
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

def _read_frontend_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_url()).rstrip("/")
API = f"{BASE}/api"
TS = int(time.time())
EMAIL = f"test_pivot_{TS}@example.com"
NAME = f"TEST_pivot_{TS}"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def locked_project_id():
    """Manually craft a locked project in Mongo to avoid 4 real LLM calls."""
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path("/app/backend/.env"))
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    from datetime import datetime, timezone
    import uuid
    now = datetime.now(timezone.utc).isoformat()
    pid = str(uuid.uuid4())
    doc = {
        "id": pid, "name": f"TEST_locked_{TS}", "creator_name": "Tester",
        "creator_email": f"test_locked_{TS}@example.com", "engine": "claude",
        "status": "locked", "step": 5,
        "situation_input": {"what": "x", "who": "y", "unclear": "z"},
        "framing": {"reframed_problem": "Reframed.", "tensions": ["t1"]},
        "context_input": {"requirements": "r"},
        "context": {"what_actually_matters": "matters", "key_signals": ["s1"]},
        "decision_input": {"optimizing_for": "speed"},
        "decision": {"recommendation": {"title": "Ship it", "confidence": 80, "rationale": "yes"}},
        "artifacts": {"scope_doc": {"title": "Scope", "in_scope": ["a"], "out_of_scope": ["b"], "deliverables": ["c"]},
                      "client_message": "Hello.", "assumptions": ["a1"], "risk_flags": []},
        "locked_at": now, "feedback": None, "created_at": now, "updated_at": now,
    }
    asyncio.get_event_loop().run_until_complete(db.projects.insert_one(doc))
    yield pid
    asyncio.get_event_loop().run_until_complete(db.projects.delete_one({"id": pid}))
    client.close()


# ===== DEDUP =====
class TestDedup:
    def test_same_email_and_name_returns_same_id(self, s):
        r1 = s.post(f"{API}/projects", json={"name": "Ada", "email": EMAIL, "project_name": NAME}, timeout=20)
        assert r1.status_code == 200, r1.text
        id1 = r1.json()["id"]
        r2 = s.post(f"{API}/projects", json={"name": "Ada Re", "email": EMAIL, "project_name": NAME}, timeout=20)
        assert r2.status_code == 200, r2.text
        id2 = r2.json()["id"]
        assert id1 == id2, "dedup must return same project id"


# ===== BY-EMAIL =====
class TestByEmail:
    def test_by_email_returns_list_sorted_desc(self, s):
        # ensure at least one project exists
        s.post(f"{API}/projects", json={"name": "Ada", "email": EMAIL, "project_name": NAME})
        # create a second project
        s.post(f"{API}/projects", json={"name": "Ada", "email": EMAIL, "project_name": f"{NAME}_two"})
        r = s.get(f"{API}/projects/by-email", params={"email": EMAIL}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 2
        # sorted desc by updated_at
        ts = [d["updated_at"] for d in data]
        assert ts == sorted(ts, reverse=True)
        # no _id leak
        for d in data:
            assert "_id" not in d
            for k in ("id", "name", "status", "step", "created_at", "updated_at"):
                assert k in d

    def test_by_email_invalid_returns_422(self, s):
        r = s.get(f"{API}/projects/by-email", params={"email": "not-an-email"}, timeout=15)
        assert r.status_code == 422


# ===== PDF EXPORT =====
class TestPdfExport:
    def test_pdf_export_content_type_and_magic(self, s, locked_project_id):
        r = s.get(f"{API}/projects/{locked_project_id}/export.pdf", timeout=30)
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF", f"not a PDF: {r.content[:8]!r}"
        assert len(r.content) > 1024, f"PDF too small: {len(r.content)}"


# ===== FEEDBACK =====
class TestFeedback:
    def test_feedback_before_lock_400(self, s):
        # create a draft project (not locked)
        r0 = s.post(f"{API}/projects", json={"name": "Bob", "email": f"draft_{TS}@example.com", "project_name": f"TEST_draft_{TS}"})
        pid = r0.json()["id"]
        assert r0.json()["status"] in ("draft", "in_progress")
        r = s.post(f"{API}/projects/{pid}/feedback", json={"sentiment": "up", "text": "x"}, timeout=15)
        assert r.status_code == 400

    def test_feedback_invalid_sentiment_422(self, s, locked_project_id):
        r = s.post(f"{API}/projects/{locked_project_id}/feedback", json={"sentiment": "maybe", "text": "x"}, timeout=15)
        assert r.status_code == 422

    def test_feedback_after_lock_persists(self, s, locked_project_id):
        r = s.post(f"{API}/projects/{locked_project_id}/feedback",
                   json={"sentiment": "up", "text": "loved it"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["feedback"]["sentiment"] == "up"
        assert body["feedback"]["text"] == "loved it"
        assert body["feedback"]["submitted_at"]
        # verify via GET
        g = s.get(f"{API}/projects/{locked_project_id}", timeout=15)
        assert g.json()["feedback"]["sentiment"] == "up"
