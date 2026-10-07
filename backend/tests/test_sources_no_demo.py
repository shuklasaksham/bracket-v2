"""Verify /api/connect/{provider}/sources returns 400 when not connected (no demo data)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

# Create a fresh user via OTP so they have zero OAuth connections
import uuid
OTP_EMAIL = f"e2e+sources-{uuid.uuid4().hex[:8]}@example.com"

SAMPLE_FILE_NAMES = [
    "Acme Dashboard.fig",
    "Mobile App Redesign",
    "Brand Identity System",
    "Landing Page v3",
    "Design System",
]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/otp/request", json={"email": OTP_EMAIL}, timeout=15)
    assert r.status_code == 200, f"otp request failed: {r.status_code} {r.text}"
    code = r.json().get("dev_code")
    assert code, f"OTP_TEST_MODE not on; no dev_code: {r.json()}"
    r = s.post(f"{API}/auth/otp/verify", json={"email": OTP_EMAIL, "code": code}, timeout=15)
    assert r.status_code == 200, f"otp verify failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("session_token") or data.get("token") or data.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    s.headers.update({"Content-Type": "application/json"})
    # sanity — should be authenticated
    who = s.get(f"{API}/auth/me", timeout=10)
    assert who.status_code == 200, f"auth/me failed: {who.status_code} {who.text}"
    return s


@pytest.mark.parametrize("provider,label", [
    ("figma", "Figma"),
    ("github", "GitHub"),
    ("slack", "Slack"),
    ("gmail", "Gmail"),
    ("notion", "Notion"),
])
def test_sources_returns_400_when_not_connected(client, provider, label):
    r = client.get(f"{API}/connect/{provider}/sources", timeout=15)
    # If already connected, endpoint returns 200 — skip
    if r.status_code == 200:
        body = r.json()
        # But it must NOT contain the hardcoded sample names
        text = str(body)
        for name in SAMPLE_FILE_NAMES:
            assert name not in text, f"{provider} returned hardcoded demo name '{name}': {body}"
        pytest.skip(f"{provider} already connected for this user; verified no sample names in response")
    assert r.status_code == 400, f"{provider}: expected 400, got {r.status_code} body={r.text}"
    body = r.json()
    detail = body.get("detail") or body.get("message") or ""
    assert "Connect your" in detail and label in detail, f"{provider}: unexpected detail: {detail}"
    # No sample names in the error either
    for name in SAMPLE_FILE_NAMES:
        assert name not in str(body), f"sample name leaked into error body: {name}"


def test_demo_seed_endpoint_removed(client):
    r = client.post(f"{API}/demo/seed", json={}, timeout=15)
    assert r.status_code in (404, 405), f"expected 404/405 for removed demo/seed, got {r.status_code}: {r.text}"
