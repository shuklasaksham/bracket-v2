"""Bracket backend API tests — auth, projects, AI decision flow."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://design-decided.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Generate unique test users per session
TS = int(time.time())
USER_A = {"email": f"tester+a{TS}@example.com", "password": "bracket123", "name": "Tester A"}
USER_B = {"email": f"tester+b{TS}@example.com", "password": "bracket123", "name": "Tester B"}


@pytest.fixture(scope="session")
def session():
    """Stateless session — Bearer-only, no cookies (avoids cookie shadowing Bearer)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    # Disable cookie persistence so cookies set by /auth/* don't shadow Bearer header on next req
    from requests.cookies import RequestsCookieJar

    class _NoCookieJar(RequestsCookieJar):
        def set_cookie(self, *a, **kw):
            return None
        def extract_cookies(self, *a, **kw):
            return None

    s.cookies = _NoCookieJar()
    return s


def _register(email_user, headers_only_session=None):
    """Use a fresh requests call so cookies don't bleed across users."""
    r = requests.post(f"{API}/auth/register", json=email_user, timeout=30)
    return r


@pytest.fixture(scope="session")
def user_a_token():
    r = _register(USER_A)
    assert r.status_code == 200, f"register A failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="session")
def user_b_token():
    r = _register(USER_B)
    assert r.status_code == 200, f"register B failed: {r.status_code} {r.text}"
    return r.json()["token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- Health ---
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"
        assert data.get("service") == "bracket"


# --- Auth ---
class TestAuth:
    def test_register_returns_user_and_token(self, user_a_token):
        assert isinstance(user_a_token, str) and len(user_a_token) > 20

    def test_register_duplicate_email_rejected(self, session):
        r = session.post(f"{API}/auth/register", json=USER_A, timeout=15)
        assert r.status_code == 400
        assert "exists" in r.text.lower() or "already" in r.text.lower()

    def test_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": USER_A["password"]}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and data["user"]["email"] == USER_A["email"].lower()

    def test_login_wrong_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": USER_A["email"], "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_with_bearer(self, session, user_a_token):
        r = session.get(f"{API}/auth/me", headers=auth_headers(user_a_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == USER_A["email"].lower()

    def test_me_without_token(self, session):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401


# --- Onboarding ---
class TestOnboarding:
    def test_save_onboarding(self, session, user_a_token):
        r = session.post(
            f"{API}/onboarding",
            json={"work_type": "freelance", "struggle": "scope"},
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["onboarded"] is True
        assert data["work_type"] == "freelance"
        assert data["struggle"] == "scope"


# --- Projects CRUD ---
class TestProjects:
    def test_create_list_project_claude(self, session, user_a_token):
        r = session.post(
            f"{API}/projects",
            json={"name": "TEST_Claude_Project", "engine": "claude"},
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["engine"] == "claude"
        assert proj["status"] == "draft"
        assert proj["step"] == 1
        pytest.shared_project_id = proj["id"]

        # list
        r2 = session.get(f"{API}/projects", headers=auth_headers(user_a_token), timeout=15)
        assert r2.status_code == 200
        ids = [p["id"] for p in r2.json()]
        assert pytest.shared_project_id in ids

    def test_delete_project(self, session, user_a_token):
        # Create a throwaway one
        r = session.post(
            f"{API}/projects",
            json={"name": "TEST_to_delete", "engine": "claude"},
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        pid = r.json()["id"]
        r2 = session.delete(f"{API}/projects/{pid}", headers=auth_headers(user_a_token), timeout=15)
        assert r2.status_code == 200
        # confirm gone
        r3 = session.get(f"{API}/projects/{pid}", headers=auth_headers(user_a_token), timeout=15)
        assert r3.status_code == 404

    def test_project_isolation(self, session, user_a_token, user_b_token):
        # User B tries to fetch user A's project
        pid = pytest.shared_project_id
        r = session.get(f"{API}/projects/{pid}", headers=auth_headers(user_b_token), timeout=15)
        assert r.status_code == 404
        # User B tries to delete A's project (should silently no-op or 404; A's project must still exist)
        session.delete(f"{API}/projects/{pid}", headers=auth_headers(user_b_token), timeout=15)
        r2 = session.get(f"{API}/projects/{pid}", headers=auth_headers(user_a_token), timeout=15)
        assert r2.status_code == 200, "User B was able to delete A's project!"


# --- AI Decision Flow (Claude) ---
class TestDecisionFlowClaude:
    def test_step1_situation(self, session, user_a_token):
        pid = pytest.shared_project_id
        body = {
            "what": "Redesign onboarding flow for a B2B SaaS analytics tool",
            "who": "Mid-market data teams currently bouncing in week 1",
            "unclear": "Whether to lead with templates or empty state coaching",
        }
        r = session.post(
            f"{API}/projects/{pid}/situation",
            json=body,
            headers=auth_headers(user_a_token),
            timeout=90,
        )
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["framing"] is not None
        f = proj["framing"]
        assert "reframed_problem" in f and len(f["reframed_problem"]) > 10
        assert "clarity_score" in f
        assert "tensions" in f and isinstance(f["tensions"], list)
        assert proj["step"] >= 2

    def test_step2_context_requires_framing(self, session, user_a_token):
        # Create fresh project with no framing
        r = session.post(
            f"{API}/projects",
            json={"name": "TEST_no_framing", "engine": "claude"},
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        pid = r.json()["id"]
        r2 = session.post(
            f"{API}/projects/{pid}/context",
            json={"requirements": "x", "constraints": "y", "inspirations": "z"},
            headers=auth_headers(user_a_token),
            timeout=30,
        )
        assert r2.status_code == 400
        # cleanup
        session.delete(f"{API}/projects/{pid}", headers=auth_headers(user_a_token))

    def test_step2_context(self, session, user_a_token):
        pid = pytest.shared_project_id
        body = {
            "requirements": "Must integrate with existing data warehouse, ship in 6 weeks",
            "constraints": "2 designers, 1 engineer, no budget for user research vendor",
            "inspirations": "Linear's onboarding, Notion's empty states",
        }
        r = session.post(
            f"{API}/projects/{pid}/context",
            json=body,
            headers=auth_headers(user_a_token),
            timeout=90,
        )
        assert r.status_code == 200, r.text
        ctx = r.json()["context"]
        assert "key_signals" in ctx and isinstance(ctx["key_signals"], list)
        assert "what_actually_matters" in ctx
        assert "noise_removed" in ctx

    def test_step3_decision(self, session, user_a_token):
        pid = pytest.shared_project_id
        body = {
            "optimizing_for": "time-to-first-insight for new users",
            "tradeoffs": "depth vs speed",
            "risks": "users churning before they reach the aha moment",
        }
        r = session.post(
            f"{API}/projects/{pid}/decision",
            json=body,
            headers=auth_headers(user_a_token),
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()["decision"]
        assert "recommendation" in d
        assert "title" in d["recommendation"]
        assert "rationale" in d["recommendation"]
        assert "confidence" in d["recommendation"]
        assert "alternatives" in d
        assert "tradeoffs" in d
        assert "risks" in d

    def test_step4_artifacts(self, session, user_a_token):
        pid = pytest.shared_project_id
        r = session.post(
            f"{API}/projects/{pid}/artifacts",
            headers=auth_headers(user_a_token),
            timeout=120,
        )
        assert r.status_code == 200, r.text
        a = r.json()["artifacts"]
        assert "scope_doc" in a
        assert "client_message" in a
        assert "assumptions" in a
        assert "risk_flags" in a

    def test_step5_lock(self, session, user_a_token):
        pid = pytest.shared_project_id
        r = session.post(
            f"{API}/projects/{pid}/lock",
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        assert r.status_code == 200
        proj = r.json()
        assert proj["status"] == "locked"
        assert proj["locked_at"] is not None


# --- GPT engine path ---
class TestGPTEngine:
    def test_gpt_situation(self, session, user_a_token):
        r = session.post(
            f"{API}/projects",
            json={"name": "TEST_GPT_Project", "engine": "gpt"},
            headers=auth_headers(user_a_token),
            timeout=15,
        )
        assert r.status_code == 200
        proj = r.json()
        assert proj["engine"] == "gpt"
        pid = proj["id"]
        body = {
            "what": "Build a pricing page for a developer tool",
            "who": "Indie devs and small startups",
            "unclear": "Whether usage-based pricing will scare off first-timers",
        }
        r2 = session.post(
            f"{API}/projects/{pid}/situation",
            json=body,
            headers=auth_headers(user_a_token),
            timeout=120,
        )
        assert r2.status_code == 200, f"GPT situation failed: {r2.status_code} {r2.text}"
        proj2 = r2.json()
        assert proj2["framing"] is not None
        assert "reframed_problem" in proj2["framing"]
        # cleanup
        session.delete(f"{API}/projects/{pid}", headers=auth_headers(user_a_token))
