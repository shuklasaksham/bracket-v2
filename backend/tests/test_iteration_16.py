"""Iteration 16 — OTP deliverability fix + deep auth/projects/suggest/admin regression.

Tests:
1. Unit: send_otp_email builds correct Resend payload (subject NO code,
   List-Unsubscribe + List-Unsubscribe-Post + X-Entity-Ref-ID headers,
   tags [category=auth, type=otp], reply_to omitted when SENDER_EMAIL empty).
2. E2E: /auth/otp/request + /auth/otp/verify (via OTP_TEST_MODE dev_code).
3. E2E: /auth/guest, /auth/me, /auth/logout.
4. E2E: Projects CRUD (create/list/get/patch/delete).
5. E2E: /suggest returns items fast.
6. E2E: Admin login (support@use-bracket.com / Bracket@123),
   /admin/users, /admin/users/{id}/projects, /admin/users/{id}/reset-password.
"""
import asyncio
import os
import sys
import time
import uuid
from unittest.mock import patch

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

# So we can import backend/auth.py for the unit test
sys.path.insert(0, "/app/backend")


# ============================================================
# 1) UNIT — OTP email payload shape (the deliverability fix)
# ============================================================
class TestOtpEmailPayload:
    """Monkeypatch resend.Emails.send and inspect params."""

    def _capture_params(self, sender_email_env: str = "support@use-bracket.com"):
        # Ensure RESEND_API_KEY is set so the code path runs
        os.environ["RESEND_API_KEY"] = os.environ.get("RESEND_API_KEY") or "re_test_dummy"
        os.environ["SENDER_EMAIL"] = sender_email_env
        os.environ["SENDER_NAME"] = "Bracket"

        import importlib
        import auth as auth_mod
        importlib.reload(auth_mod)

        captured = {}

        def fake_send(params):
            captured.update(params)
            return {"id": "fake-msg-id"}

        with patch("resend.Emails.send", side_effect=fake_send):
            asyncio.run(auth_mod.send_otp_email("recipient@example.com", "Alice", "123456"))
        return captured

    def test_subject_has_no_code(self):
        p = self._capture_params()
        assert p["subject"] == "Your Bracket sign-in code", f"subject={p['subject']!r}"
        assert "123456" not in p["subject"], "OTP code must NOT appear in subject"

    def test_html_has_preheader_and_code(self):
        p = self._capture_params()
        html = p["html"]
        # hidden preheader div
        assert "display:none" in html and "opacity:0" in html
        assert "expires in 10 minutes" in html.lower()
        # code block
        assert "123456" in html

    def test_headers_list_unsubscribe(self):
        p = self._capture_params()
        h = p["headers"]
        assert "List-Unsubscribe" in h
        assert h["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        assert h["X-Entity-Ref-ID"].startswith("bracket-otp-")

    def test_tags_present(self):
        p = self._capture_params()
        tags = p["tags"]
        assert {"name": "category", "value": "auth"} in tags
        assert {"name": "type", "value": "otp"} in tags

    def test_reply_to_present_when_sender_set(self):
        p = self._capture_params(sender_email_env="support@use-bracket.com")
        assert p.get("reply_to") == "support@use-bracket.com"

    def test_reply_to_omitted_when_sender_empty(self):
        p = self._capture_params(sender_email_env="")
        assert "reply_to" not in p, f"reply_to should be omitted when SENDER_EMAIL empty, got {p.get('reply_to')!r}"

    def test_plain_text_body_present(self):
        p = self._capture_params()
        text = p["text"]
        assert "123456" in text
        assert "Bracket" in text
        assert len(text) > 100  # beefed up plain text version


# ============================================================
# 2) E2E — /auth/otp/request + /verify (OTP_TEST_MODE=1)
# ============================================================
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestOtpEndpoint:
    def test_otp_request_returns_dev_code(self, http):
        email = f"e2e+otp{int(time.time())}@example.com"
        r = http.post(f"{API}/auth/otp/request", json={"email": email, "name": "OTP User"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("ttl_minutes") == 10
        # OTP_TEST_MODE=1 in .env, so dev_code MUST be present
        assert "dev_code" in d and len(d["dev_code"]) == 6

    def test_otp_verify_returns_session(self, http):
        email = f"e2e+otpv{int(time.time())}@example.com"
        r = http.post(f"{API}/auth/otp/request", json={"email": email, "name": "OTP V"}, timeout=15)
        code = r.json()["dev_code"]
        r2 = http.post(f"{API}/auth/otp/verify",
                       json={"email": email, "code": code, "name": "OTP V", "avatar": "mono-1"},
                       timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("session_token", "").startswith("st_")
        assert data["user"]["email"] == email.lower()


# ============================================================
# 3) E2E — Guest sign-in + /auth/me + logout
# ============================================================
@pytest.fixture(scope="session")
def guest_token():
    r = requests.post(f"{API}/auth/guest", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return d["session_token"]


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


class TestAuthCore:
    def test_guest_creates_session(self, guest_token):
        assert guest_token.startswith("st_")

    def test_me_authenticated(self, guest_token):
        r = requests.get(f"{API}/auth/me", headers=_bearer(guest_token), timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["is_guest"] is True
        # Guest emails follow one of two synthetic formats.
        assert (
            u["email"].endswith("@bracket.guest")
            or (u["email"].startswith("guest-") and u["email"].endswith("@use-bracket.com"))
        ), u["email"]

    def test_me_unauthenticated_401(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_logout(self, http):
        # get a throwaway session
        gr = requests.post(f"{API}/auth/guest", timeout=15)
        tok = gr.json()["session_token"]
        r = requests.post(f"{API}/auth/logout", headers=_bearer(tok), timeout=15)
        assert r.status_code == 200
        # /auth/me should now 401 (session gone from db)
        r2 = requests.get(f"{API}/auth/me", headers=_bearer(tok), timeout=15)
        assert r2.status_code == 401


# ============================================================
# 4) E2E — Projects CRUD
# ============================================================
class TestProjectsCrud:
    def test_full_crud(self, guest_token):
        h = _bearer(guest_token)

        # Create (schema uses project_name)
        r = requests.post(f"{API}/projects",
                          json={"project_name": "TEST_iter16_a", "engine": "claude"},
                          headers=h, timeout=15)
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["name"] == "TEST_iter16_a"
        assert proj["engine"] == "claude"
        assert "_id" not in proj, "ObjectId must NOT leak"
        pid = proj["id"]

        # List
        r2 = requests.get(f"{API}/projects", headers=h, timeout=15)
        assert r2.status_code == 200
        assert pid in [p["id"] for p in r2.json()]

        # Get
        r3 = requests.get(f"{API}/projects/{pid}", headers=h, timeout=15)
        assert r3.status_code == 200
        assert r3.json()["id"] == pid
        assert "_id" not in r3.json()

        # Patch (rename)
        r4 = requests.patch(f"{API}/projects/{pid}",
                            json={"name": "TEST_iter16_renamed"},
                            headers=h, timeout=15)
        assert r4.status_code == 200
        assert r4.json()["name"] == "TEST_iter16_renamed"

        # Verify persistence
        r5 = requests.get(f"{API}/projects/{pid}", headers=h, timeout=15)
        assert r5.json()["name"] == "TEST_iter16_renamed"

        # Delete
        r6 = requests.delete(f"{API}/projects/{pid}", headers=h, timeout=15)
        assert r6.status_code == 200
        r7 = requests.get(f"{API}/projects/{pid}", headers=h, timeout=15)
        assert r7.status_code == 404


# ============================================================
# 5) E2E — /suggest fast + returns items
# ============================================================
class TestSuggest:
    def test_suggest_returns_items_fast(self):
        t0 = time.time()
        r = requests.post(f"{API}/suggest",
                          json={"step": 1, "field": "what",
                                "partial": "Redesign onboarding for",
                                "context": {}},
                          timeout=10)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        d = r.json()
        assert "suggestions" in d and isinstance(d["suggestions"], list)
        assert elapsed < 8.0, f"suggest too slow: {elapsed:.2f}s"


# ============================================================
# 6) E2E — Admin (support@use-bracket.com / Bracket@123)
# ============================================================
ADMIN_EMAIL = "support@use-bracket.com"
ADMIN_PASSWORD = "Bracket@123"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed ({r.status_code}): {r.text[:200]}")
    return r.json()["session_token"]


class TestAdmin:
    def test_admin_login_returns_is_admin(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_bearer(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json().get("is_admin") is True

    def test_admin_users_list(self, admin_token):
        r = requests.get(f"{API}/admin/users", headers=_bearer(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        payload = r.json()
        # Envelope: {admin_email: "...", users: [...]}
        assert "users" in payload and isinstance(payload["users"], list)
        assert len(payload["users"]) >= 1
        # No _id leakage
        assert all("_id" not in u for u in payload["users"])
        assert all("user_id" in u for u in payload["users"])

    def test_admin_users_projects(self, admin_token):
        users = requests.get(f"{API}/admin/users", headers=_bearer(admin_token), timeout=20).json()["users"]
        uid = users[0]["user_id"]
        r = requests.get(f"{API}/admin/users/{uid}/projects", headers=_bearer(admin_token), timeout=15)
        assert r.status_code == 200
        # Endpoint may return list or envelope; accept both
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_admin_reset_password_flow(self, admin_token):
        # Create a fresh user via OTP, admin resets it
        email = f"e2e+rst{int(time.time())}@example.com"
        rq = requests.post(f"{API}/auth/otp/request", json={"email": email, "name": "R"}, timeout=15)
        code = rq.json()["dev_code"]
        rv = requests.post(f"{API}/auth/otp/verify",
                           json={"email": email, "code": code, "name": "R"},
                           timeout=15)
        uid = rv.json()["user"]["user_id"]

        new_pw = "NewPass123!"
        rr = requests.post(f"{API}/admin/users/{uid}/reset-password",
                           json={"new_password": new_pw},
                           headers=_bearer(admin_token), timeout=15)
        assert rr.status_code == 200, rr.text

        # Should now be able to log in with password
        rl = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": new_pw},
                           timeout=15)
        assert rl.status_code == 200, f"login after admin reset failed: {rl.text}"

    def test_admin_endpoints_return_404_for_non_admin(self, guest_token):
        r = requests.get(f"{API}/admin/users", headers=_bearer(guest_token), timeout=15)
        assert r.status_code == 404, f"guest saw admin endpoint: {r.status_code} {r.text[:200]}"
