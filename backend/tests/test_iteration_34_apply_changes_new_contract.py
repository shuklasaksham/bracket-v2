"""
Iteration 34 backend tests — NEW /review/apply-changes contract.

Replaces iteration_33 response-shape assertions ({step, items} + navigate to
flow). The endpoint now:
  - Automatically regenerates the affected steps + artifacts with the client's
    changes injected (via run_situation_framing/run_context_compression/
    run_decision_engine/run_artifacts).
  - Sets status='locked', step=5, share_status='sent', revising=False,
    revision_context=None, last_change_note=<AI-drafted note>.
  - Emails the client (fire-and-forget).
  - Returns 200 {steps_updated: [...], note: '...'} — earliest mapped step
    through 4 (artifacts) always included.

IMPORTANT — the endpoint chains 3-6 Claude calls (~90-130s). The public
REACT_APP_BACKEND_URL ingress (Cloudflare) times out around 100s and returns
502 → the tests that call apply-changes hit BACKEND_INTERNAL_URL
(http://localhost:8001) to bypass the ingress. Fast validation tests still hit
the public URL to match what the user sees. See iteration_34.json report for
the ingress-timeout finding.
"""
import os
import copy
import time
import uuid
import requests
import pytest
from pymongo import MongoClient

# Public URL — what the user hits (subject to Cloudflare ~100s timeout).
def _frontend_env_backend_url():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env_backend_url()).rstrip("/")
# Internal URL — bypasses Cloudflare so we can measure the true endpoint.
INTERNAL_URL = os.environ.get("BACKEND_INTERNAL_URL", "http://localhost:8001").rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bracket_db")

DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"
DEMO_PROJECT_ID = "0b9effac-2b12-4beb-9f9a-40ab7213d23f"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login_session(url):
    """Session logged in against `url`. When url is http:// (localhost), the
    session_token cookie has Secure so `requests` won't auto-send it back —
    we pin the cookie header manually."""
    s = requests.Session()
    r = s.post(
        f"{url}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    tok = s.cookies.get("session_token")
    if tok and url.startswith("http://"):
        s.headers["Cookie"] = f"session_token={tok}"
    return s


@pytest.fixture(scope="module")
def demo_session():
    """Public-URL session for fast tests (matches user experience)."""
    s = _login_session(BASE_URL)
    yield s
    s.close()


@pytest.fixture(scope="module")
def internal_session():
    """Localhost session for long-running LLM calls that would exceed the
    ingress timeout."""
    s = _login_session(INTERNAL_URL)
    yield s
    s.close()


def _seed_project(mongo, share_status="rejected", suggestions=None):
    """Copy the seed Ceramic Vase project into a rejected state with a full
    share_review payload."""
    base = mongo.projects.find_one({"id": DEMO_PROJECT_ID}, {"_id": 0})
    assert base, "Ceramic Vase seed project missing"
    p = copy.deepcopy(base)
    new_id = f"TESTREV-{uuid.uuid4().hex[:12]}"
    p["id"] = new_id
    p["name"] = f"TEST_apply_v2_{new_id[-6:]}"
    p["share_token"] = f"tok_{uuid.uuid4().hex[:12]}"
    p["share_status"] = share_status
    p["status"] = "locked"
    p["revising"] = False
    p["revision_context"] = None
    p["owner_replies"] = []
    p["step"] = 5
    p.setdefault(
        "situation_input",
        {"who": "Ceramic studio", "what": "Launch new vase line", "why_now": "Q1", "constraints": ""},
    )
    p.setdefault(
        "context_input",
        {"objectives": "Launch on time", "requirements": "3 vase designs", "constraints": "$5k budget"},
    )
    p.setdefault(
        "decision_input",
        {"options": "A vs B", "optimizing_for": "quality within budget"},
    )
    if suggestions is None:
        suggestions = [
            {
                "title": "Extend delivery window by 2 weeks",
                "what_to_change": "Adjust scope timeline note to reflect an extra 2 weeks of production.",
                "what_to_say": "We can add two weeks to production, no scope change.",
                "why_it_helps": "Reduces the client's timeline anxiety while keeping scope intact.",
                "affects_step": 4,
            },
            {
                "title": "Reduce deliverables count",
                "what_to_change": "Drop the third 'showcase piece' from deliverables and keep two.",
                "what_to_say": "Happy to trim deliverables to align with your budget.",
                "why_it_helps": "Aligns with client's cost sensitivity.",
                "affects_step": 4,
            },
        ]
    p["share_review"] = {
        "type": "reject",
        "submitted_at": "2026-01-01T00:00:00+00:00",
        "signature_name": "Test Client",
        "role": "Buyer",
        # Obviously-invalid-but-well-formed address to avoid spam (RESEND may
        # be configured; email failures MUST NOT fail the endpoint).
        "client_email": "client-test+bracket@example.invalid",
        "concerns": "Timeline is too tight, please rework scope.",
        "ai_suggestions": {
            "summary": "Client wants scope + timeline revised.",
            "suggestions": suggestions,
        },
    }
    p["updated_at"] = "2026-01-01T00:00:00+00:00"
    mongo.projects.insert_one(p)
    return new_id


@pytest.fixture()
def seeded_rejected_project(mongo):
    pid = _seed_project(mongo, share_status="rejected")
    yield pid
    mongo.projects.delete_one({"id": pid})


@pytest.fixture()
def seeded_awaiting_project(mongo):
    pid = _seed_project(mongo, share_status="awaiting_reply")
    yield pid
    mongo.projects.delete_one({"id": pid})


@pytest.fixture()
def seeded_sent_project(mongo):
    pid = _seed_project(mongo, share_status="sent", suggestions=[])
    yield pid
    mongo.projects.delete_one({"id": pid})


# ---------- 1. apply-changes NEW contract (via INTERNAL URL — LLM takes ~120s) ----------
class TestApplyChangesNewContract:
    def test_apply_changes_regenerates_locks_and_returns_new_shape(
        self, internal_session, seeded_rejected_project, mongo
    ):
        pid = seeded_rejected_project
        before = mongo.projects.find_one({"id": pid}, {"_id": 0})
        before_updated_at = before.get("updated_at")

        r = internal_session.post(
            f"{INTERNAL_URL}/api/projects/{pid}/review/apply-changes",
            timeout=30,
        )
        assert r.status_code == 200, f"apply-changes failed: {r.status_code} {r.text}"
        # ASYNC contract: the endpoint returns immediately and a background
        # task does the regeneration. Poll mongo until it completes.
        assert r.json().get("status") == "applying", f"unexpected body: {r.text}"

        t0 = time.time()
        p = None
        while time.time() - t0 < 300:
            p = mongo.projects.find_one({"id": pid}, {"_id": 0})
            if p and not p.get("applying_changes"):
                break
            time.sleep(5)
        elapsed = time.time() - t0
        print(f"[apply-changes] pipeline elapsed={elapsed:.1f}s")
        assert p and not p.get("applying_changes"), "pipeline never finished"

        # DB side-effects
        assert p["status"] == "locked", f"status={p['status']}"
        assert p["step"] == 5, f"step={p['step']}"
        assert p["share_status"] == "sent", f"share_status={p['share_status']}"
        assert p.get("revising") in (False, None)
        assert p.get("revision_context") is None
        assert p.get("last_change_note"), "last_change_note not set"
        assert p["updated_at"] != before_updated_at, "updated_at unchanged"

        # decision_input.optimizing_for must carry the CLIENT-REQUESTED CHANGES block.
        opt = (p.get("decision_input") or {}).get("optimizing_for", "")
        assert "[CLIENT-REQUESTED CHANGES" in opt, f"optimizing_for missing marker: {opt!r}"

        assert p.get("decision"), "decision missing after regeneration"
        assert p.get("artifacts"), "artifacts missing after regeneration"

    def test_apply_changes_works_on_awaiting_reply(self, internal_session, seeded_awaiting_project, mongo):
        r = internal_session.post(
            f"{INTERNAL_URL}/api/projects/{seeded_awaiting_project}/review/apply-changes",
            timeout=30,
        )
        assert r.status_code == 200, f"apply-changes on awaiting_reply failed: {r.status_code} {r.text}"
        assert r.json().get("status") == "applying"
        t0 = time.time()
        p = None
        while time.time() - t0 < 300:
            p = mongo.projects.find_one({"id": seeded_awaiting_project}, {"_id": 0})
            if p and not p.get("applying_changes"):
                break
            time.sleep(5)
        assert p and not p.get("applying_changes"), "pipeline never finished"
        assert p["share_status"] == "sent"
        assert p.get("last_change_note"), "last_change_note not set"

    # 400 / auth checks are FAST — use public URL to match user experience.
    def test_apply_changes_400_on_sent(self, demo_session, seeded_sent_project):
        r = demo_session.post(
            f"{BASE_URL}/api/projects/{seeded_sent_project}/review/apply-changes",
            timeout=15,
        )
        assert r.status_code == 400

    def test_apply_changes_400_when_no_suggestions(self, demo_session, mongo):
        pid = _seed_project(mongo, share_status="rejected", suggestions=[])
        try:
            r = demo_session.post(
                f"{BASE_URL}/api/projects/{pid}/review/apply-changes",
                timeout=15,
            )
            assert r.status_code == 400
        finally:
            mongo.projects.delete_one({"id": pid})

    def test_apply_changes_requires_owner_session(self, seeded_rejected_project):
        r = requests.post(
            f"{BASE_URL}/api/projects/{seeded_rejected_project}/review/apply-changes",
            timeout=15,
        )
        assert r.status_code in (401, 403, 404)


# ---------- 2. Manual re-lock path (POST /projects/{id}/lock on rejected) ----------
class TestManualReLock:
    def test_lock_on_rejected_flips_to_sent(self, demo_session, seeded_rejected_project, mongo):
        pid = seeded_rejected_project
        r = demo_session.post(f"{BASE_URL}/api/projects/{pid}/lock", timeout=30)
        assert r.status_code == 200, f"lock failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["status"] == "locked"
        assert data["share_status"] == "sent"
        p = mongo.projects.find_one({"id": pid}, {"_id": 0})
        assert p.get("revising") in (False, None)
        assert p.get("revision_context") in (None, {}, {"step": None})


# ---------- 3. Public share endpoint after apply-changes ----------
class TestPublicShareAfterApply:
    def test_public_share_serves_regenerated(self, internal_session, seeded_rejected_project, mongo):
        pid = seeded_rejected_project
        r = internal_session.post(
            f"{INTERNAL_URL}/api/projects/{pid}/review/apply-changes",
            timeout=30,
        )
        assert r.status_code == 200
        t0 = time.time()
        p = None
        while time.time() - t0 < 300:
            p = mongo.projects.find_one({"id": pid}, {"_id": 0})
            if p and not p.get("applying_changes"):
                break
            time.sleep(5)
        assert p and p.get("share_status") == "sent", "pipeline did not finish as sent"
        token = p["share_token"]
        # Public share serves the regenerated artifacts (test via BASE_URL too
        # — this call is fast, so the ingress is fine).
        r2 = requests.get(f"{BASE_URL}/api/share/{token}", timeout=30)
        assert r2.status_code == 200
        body = r2.json()
        assert body.get("share_status") == "sent"
        assert body.get("artifacts"), "public share missing artifacts"
        assert body.get("decision"), "public share missing decision"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
