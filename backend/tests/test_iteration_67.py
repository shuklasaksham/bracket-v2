"""
Tests for iteration 67:
- OTP login flow works and returns dev_code
- Onboarding endpoints (preview / establish / providers) are reachable
  through the EXTERNAL base URL and NEVER return an HTML 502 / Cloudflare
  "invalid or incomplete response" page. They must return structured JSON.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend .env as fallback
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

TEST_EMAIL = "support@use-bracket.com"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_session(session):
    """Login via Email OTP flow."""
    r = session.post(
        f"{BASE_URL}/api/auth/otp/request",
        json={"email": TEST_EMAIL},
        timeout=30,
    )
    assert r.status_code == 200, f"OTP request failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "dev_code" in data, f"dev_code missing (OTP_TEST_MODE off?): {data}"

    r2 = session.post(
        f"{BASE_URL}/api/auth/otp/verify",
        json={"email": TEST_EMAIL, "code": data["dev_code"]},
        timeout=30,
    )
    assert r2.status_code == 200, f"OTP verify failed: {r2.status_code} {r2.text[:300]}"
    return session


# --- OTP login -----------------------------------------------------------

def test_otp_request_returns_dev_code(session):
    r = session.post(
        f"{BASE_URL}/api/auth/otp/request",
        json={"email": TEST_EMAIL},
        timeout=30,
    )
    assert r.status_code == 200
    j = r.json()
    assert "dev_code" in j
    assert isinstance(j["dev_code"], str) and len(j["dev_code"]) >= 4


def test_otp_verify_sets_session(auth_session):
    # /api/auth/me should now respond 200
    r = auth_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert r.status_code == 200, r.text[:300]
    me = r.json()
    assert me.get("email") == TEST_EMAIL


# --- Onboarding endpoints: origin must stay healthy (JSON, not 502 HTML) --

def _assert_json_not_cloudflare(resp):
    """Response must be JSON — never a Cloudflare/nginx HTML error page."""
    assert resp.status_code < 500, (
        f"5xx from origin ({resp.status_code}); body starts: {resp.text[:200]!r}"
    )
    ctype = resp.headers.get("content-type", "")
    assert "application/json" in ctype, (
        f"Non-JSON response ({ctype}); body starts: {resp.text[:200]!r}"
    )
    # Must be parseable
    resp.json()


def test_connect_providers_reachable(auth_session):
    r = auth_session.get(f"{BASE_URL}/api/connect/providers", timeout=30)
    assert r.status_code == 200, r.text[:300]
    _assert_json_not_cloudflare(r)
    j = r.json()
    # Should be a list or dict describing providers
    assert isinstance(j, (list, dict))


def test_connect_preview_returns_structured_json(auth_session):
    """
    Even for an invalid/orphaned request, /connect/preview must return
    structured JSON (with a 'detail' on 4xx) — NOT a Cloudflare 502 HTML.
    """
    r = auth_session.post(
        f"{BASE_URL}/api/connect/preview",
        json={"provider": "gmail", "sources": []},
        timeout=60,
    )
    _assert_json_not_cloudflare(r)
    # Either success (200) or a clean 4xx
    assert r.status_code in (200, 400, 401, 403, 404, 409, 422), (
        f"Unexpected status {r.status_code}: {r.text[:300]}"
    )
    j = r.json()
    if r.status_code >= 400:
        # FastAPI style error
        assert "detail" in j or "error" in j or "message" in j, j


def test_connect_establish_returns_structured_json(auth_session):
    r = auth_session.post(
        f"{BASE_URL}/api/connect/establish",
        json={"provider": "gmail", "sources": []},
        timeout=60,
    )
    _assert_json_not_cloudflare(r)
    assert r.status_code in (200, 400, 401, 403, 404, 409, 422), (
        f"Unexpected status {r.status_code}: {r.text[:300]}"
    )
    j = r.json()
    if r.status_code >= 400:
        assert "detail" in j or "error" in j or "message" in j, j


def test_connect_preview_unauth_is_json(session):
    """Even unauthenticated, must be JSON (not Cloudflare HTML)."""
    fresh = requests.Session()
    fresh.headers.update({"Content-Type": "application/json"})
    r = fresh.post(
        f"{BASE_URL}/api/connect/preview",
        json={"provider": "gmail", "sources": []},
        timeout=30,
    )
    _assert_json_not_cloudflare(r)
    assert r.status_code in (401, 403, 422), r.status_code
