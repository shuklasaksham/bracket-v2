"""Iteration 20: Admin project detail endpoint tests."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # fall back to reading frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "support@use-bracket.com"
ADMIN_PW = "Bracket@123"
YASHWORK_PROJECT_ID = "9001ec1b-5f38-4ade-a302-c0e85ff6ce94"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def nonadmin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/request",
               json={"email": "e2e+iter20@example.com", "name": "Iter20 Tester"}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    code = r.json().get("dev_code")
    assert code, "dev_code missing — OTP_TEST_MODE off?"
    r2 = s.post(f"{BASE_URL}/api/auth/otp/verify",
                json={"email": "e2e+iter20@example.com", "code": code,
                      "name": "Iter20 Tester", "designation": "QA", "avatar": "mono-1"},
                timeout=15)
    assert r2.status_code == 200, r2.text[:200]
    return s


def test_admin_project_detail_success(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/projects/{YASHWORK_PROJECT_ID}", timeout=15)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "project" in body and "owner" in body
    p = body["project"]
    assert p.get("id") == YASHWORK_PROJECT_ID
    # Forbidden fields
    assert "_id" not in p
    assert "share_token" not in p
    # Required fields
    for k in ["name", "status", "step", "engine", "created_at", "updated_at",
              "owner_user_id", "creator_email", "share_status"]:
        assert k in p, f"missing field {k}"
    owner = body["owner"]
    if owner is not None:
        for k in ["user_id", "email", "name", "designation"]:
            assert k in owner, f"owner missing {k}"


def test_admin_project_detail_anon_404():
    r = requests.get(f"{BASE_URL}/api/admin/projects/{YASHWORK_PROJECT_ID}", timeout=15)
    assert r.status_code == 404, r.text[:200]


def test_admin_project_detail_nonadmin_404(nonadmin_session):
    r = nonadmin_session.get(f"{BASE_URL}/api/admin/projects/{YASHWORK_PROJECT_ID}", timeout=15)
    assert r.status_code == 404, r.text[:200]


def test_admin_project_detail_missing_404(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/projects/does-not-exist", timeout=15)
    assert r.status_code == 404, r.text[:200]


# Regression — analytics still works
def test_admin_analytics_regression(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/analytics", timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ["kpis", "new_users_daily", "projects_daily", "status_distribution",
              "step_funnel", "share_funnel", "activity_heatmap"]:
        assert k in d


# Regression — user list + user projects still work
def test_admin_users_list_regression(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "users" in d and isinstance(d["users"], list)
    assert len(d["users"]) > 0
