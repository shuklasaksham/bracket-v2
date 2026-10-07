"""Tests for the new admin-only POST /api/admin/purge-users endpoint.

Scope (from iteration_23 review request):
- Auth boundary: 404 for unauth / guest / non-admin.
- Default patterns + dry-run defaults.
- Custom patterns filter correctly.
- Admin self-protection (email cannot be in matched_users even if pattern matches).
- Full lifecycle: OTP-create victim user -> dry-run -> confirm delete -> re-run 0.
- Cascade: victim's projects (and user_sessions) counted and deleted.
"""
import os
import re
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to preview frontend .env if the env var isn't in this shell
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

ADMIN_EMAIL = "support@use-bracket.com"
ADMIN_PASSWORD = "Bracket@123"

# Unique run-scoped prefix so cleanup can be surgical even if a test aborts.
RUN_ID = uuid.uuid4().hex[:8]
PURGE_PREFIX = f"purge-test-{RUN_ID}-"


# ----------------------------- helpers ---------------------------------------
def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _admin_session():
    s = _new_session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["email"].lower() == ADMIN_EMAIL
    # Sanity: /auth/me must be admin
    me = s.get(f"{BASE_URL}/api/auth/me")
    assert me.status_code == 200 and me.json().get("is_admin") is True, me.text
    return s


def _guest_session():
    s = _new_session()
    r = s.post(f"{BASE_URL}/api/auth/guest")
    assert r.status_code == 200, r.text
    return s


def _otp_signup(email: str, name: str = "Purge Test"):
    """Create a real (non-guest) user via the dev-mode OTP flow. Returns
    an authed requests.Session for that user."""
    s = _new_session()
    r = s.post(f"{BASE_URL}/api/auth/otp/request", json={"email": email, "name": name})
    assert r.status_code == 200, f"otp/request failed: {r.text}"
    body = r.json()
    dev_code = body.get("dev_code")
    assert dev_code, f"dev_code missing (OTP_TEST_MODE?): {body}"
    r2 = s.post(
        f"{BASE_URL}/api/auth/otp/verify",
        json={"email": email, "code": dev_code, "name": name, "avatar": "mono-1"},
    )
    assert r2.status_code == 200, f"otp/verify failed: {r2.text}"
    return s


def _purge(session: requests.Session, **body):
    return session.post(f"{BASE_URL}/api/admin/purge-users", json=body)


# ----------------------------- fixtures --------------------------------------
@pytest.fixture(scope="module")
def admin():
    return _admin_session()


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup():
    """Belt-and-suspenders cleanup — even if a test aborts, always purge our
    run-scoped throwaway users at teardown."""
    yield
    try:
        s = _admin_session()
        _purge(s, patterns=f"^{PURGE_PREFIX}", confirm=True)
    except Exception as exc:  # noqa: BLE001
        print("final cleanup failed:", exc)


# ==============================================================================
# 1. Auth boundary tests
# ==============================================================================
class TestAuthBoundary:
    def test_no_session_returns_404(self):
        s = _new_session()
        r = _purge(s)
        assert r.status_code == 404
        assert r.json() == {"detail": "Not found"}, r.text

    def test_guest_session_returns_404(self):
        s = _guest_session()
        r = _purge(s)
        assert r.status_code == 404
        assert r.json() == {"detail": "Not found"}, r.text

    def test_non_admin_real_user_returns_404(self):
        # A fresh OTP-created user is not in ADMIN_EMAILS, so must 404.
        email = f"{PURGE_PREFIX}nonadmin@example.com"
        s = _otp_signup(email, name="Non Admin")
        r = _purge(s)
        assert r.status_code == 404, r.text
        assert r.json() == {"detail": "Not found"}


# ==============================================================================
# 2. Defaults + custom patterns (dry-run only, no mutation)
# ==============================================================================
class TestDefaultsAndPatterns:
    def test_empty_body_uses_default_patterns_dry_run(self, admin):
        r = _purge(admin)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        # Default automation set has exactly 11 patterns per server.py.
        assert isinstance(body["patterns"], list)
        assert len(body["patterns"]) == 11, body["patterns"]
        # Shape checks
        assert isinstance(body["matched_users"], int)
        assert set(body["cascade"].keys()) >= {"projects", "user_sessions", "email_otps"}
        assert isinstance(body["sample_emails"], list)
        # No deletion happened => no `deleted` key on dry-run
        assert "deleted" not in body

    def test_custom_nonexistent_pattern_matches_zero(self, admin):
        r = _purge(admin, patterns="^example-nonexistent-")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert body["patterns"] == ["^example-nonexistent-"]
        assert body["matched_users"] == 0
        assert body["sample_emails"] == []
        assert body["cascade"]["projects"] == 0
        assert body["cascade"]["user_sessions"] == 0

    def test_admin_never_in_matched_users(self, admin):
        # Pattern that WOULD match the admin email — the endpoint MUST skip it.
        r = _purge(admin, patterns="^support@")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        # Admin email must never appear in sample_emails.
        assert ADMIN_EMAIL not in [e.lower() for e in body["sample_emails"]]
        # And more strongly: nothing beginning with support@ should have matched
        # (there are no other support@ users seeded).
        for e in body["sample_emails"]:
            assert not e.lower().startswith("support@"), f"admin-like leaked: {e}"


# ==============================================================================
# 3. Explicit-confirm delete lifecycle
# ==============================================================================
class TestConfirmDeleteLifecycle:
    def test_full_lifecycle_single_user(self, admin):
        email = f"{PURGE_PREFIX}single@example.com"
        _otp_signup(email, name="Single Purge Target")

        pattern = f"^{PURGE_PREFIX}single"

        # 3a. Dry-run finds 1
        r = _purge(admin, patterns=pattern)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["dry_run"] is True
        assert body["matched_users"] == 1, body
        assert email in [e.lower() for e in body["sample_emails"]]
        assert "deleted" not in body

        # 3b. Confirm delete
        r2 = _purge(admin, patterns=pattern, confirm=True)
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["dry_run"] is False
        assert body2["matched_users"] == 1
        assert body2["deleted"]["users"] == 1
        # session was created at OTP verify, so should be >=1 sess deleted
        assert body2["deleted"]["user_sessions"] >= 1

        # 3c. Follow-up dry-run shows 0
        r3 = _purge(admin, patterns=pattern)
        assert r3.status_code == 200, r3.text
        body3 = r3.json()
        assert body3["matched_users"] == 0
        assert body3["sample_emails"] == []


# ==============================================================================
# 4. Cascade delete — user with projects
# ==============================================================================
class TestCascade:
    def test_cascade_projects_and_sessions(self, admin):
        email = f"{PURGE_PREFIX}cascade@example.com"
        user_s = _otp_signup(email, name="Cascade Target")

        # Create 2 projects for that user
        made = []
        for i in range(2):
            r = user_s.post(
                f"{BASE_URL}/api/projects",
                json={"project_name": f"TEST_purge_cascade_{RUN_ID}_{i}", "engine": "claude"},
            )
            assert r.status_code == 200, r.text
            made.append(r.json()["id"])
        assert len(made) == 2

        pattern = f"^{PURGE_PREFIX}cascade"

        # 4a. Dry-run: cascade.projects == 2
        r = _purge(admin, patterns=pattern)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["matched_users"] == 1
        assert body["cascade"]["projects"] == 2, body
        assert body["cascade"]["user_sessions"] >= 1

        # 4b. Confirm delete
        r2 = _purge(admin, patterns=pattern, confirm=True)
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2["dry_run"] is False
        assert body2["deleted"]["users"] == 1
        assert body2["deleted"]["projects"] == 2, body2
        assert body2["deleted"]["user_sessions"] >= 1

        # 4c. Verify user gone and projects gone via a follow-up dry-run
        r3 = _purge(admin, patterns=pattern)
        assert r3.json()["matched_users"] == 0
        # And directly: admin listing shouldn't reveal the emails either.
        # (We can't hit the raw DB from here, but the endpoint's own state
        # is authoritative for these tests.)


# ==============================================================================
# 5. Method / validation sanity
# ==============================================================================
class TestMethodAndValidation:
    def test_get_method_not_allowed_or_404(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/purge-users")
        # FastAPI returns 405 for wrong method on an existing path.
        assert r.status_code in (404, 405), r.text
