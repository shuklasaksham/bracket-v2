"""Iteration 22 — Backend tests for GET /api/public/metrics.

Verifies the anonymous public metrics endpoint used by the landing page.
"""
import os
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://design-decided.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

REQUIRED_KEYS = {
    "freelancers_and_teams",
    "projects_scoped",
    "requirements_extracted",
    "risks_identified",
    "client_questions_generated",
    "projects_started_with_ai",
}


@pytest.fixture(scope="module")
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "support@use-bracket.com", "password": "Bracket@123"},
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed with {r.status_code}")
    return s


# -- Public metrics endpoint --------------------------------------------------
class TestPublicMetrics:
    def test_anon_returns_200(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/metrics")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_anon_no_auth_needed_no_cookies_sent(self):
        # Fresh session with no auth headers/cookies at all.
        r = requests.get(f"{BASE_URL}/api/public/metrics")
        assert r.status_code == 200

    def test_response_has_all_six_keys(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/metrics")
        data = r.json()
        missing = REQUIRED_KEYS - set(data.keys())
        assert not missing, f"Missing keys: {missing}"

    def test_no_extra_leaky_keys(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/metrics")
        data = r.json()
        # Only the 6 aggregate keys should be returned.
        assert set(data.keys()) == REQUIRED_KEYS

    def test_all_values_non_negative_ints(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/public/metrics")
        data = r.json()
        for k in REQUIRED_KEYS:
            v = data[k]
            assert isinstance(v, int), f"{k} is not int (got {type(v).__name__}={v})"
            assert v >= 0, f"{k} is negative: {v}"


# -- Cross-check against admin analytics --------------------------------------
class TestPublicMetricsVsAdminAnalytics:
    """Spot-check: same numbers should back the admin dashboard."""

    def test_freelancers_matches_admin_total_users(self, anon_client, admin_client):
        pub = anon_client.get(f"{BASE_URL}/api/public/metrics").json()
        adm = admin_client.get(f"{BASE_URL}/api/admin/analytics").json()
        # Both count db.users total.
        assert pub["freelancers_and_teams"] == adm["kpis"]["total_users"], (
            f"public={pub['freelancers_and_teams']} vs admin={adm['kpis']['total_users']}"
        )

    def test_projects_scoped_le_admin_total_projects(self, anon_client, admin_client):
        pub = anon_client.get(f"{BASE_URL}/api/public/metrics").json()
        adm = admin_client.get(f"{BASE_URL}/api/admin/analytics").json()
        # Scoped is a subset of total projects.
        assert pub["projects_scoped"] <= adm["kpis"]["total_projects"]

    def test_projects_started_le_admin_total_projects(self, anon_client, admin_client):
        pub = anon_client.get(f"{BASE_URL}/api/public/metrics").json()
        adm = admin_client.get(f"{BASE_URL}/api/admin/analytics").json()
        # Any project with a framing step is still a project.
        assert pub["projects_started_with_ai"] <= adm["kpis"]["total_projects"]

    def test_locked_projects_le_projects_scoped(self, anon_client, admin_client):
        pub = anon_client.get(f"{BASE_URL}/api/public/metrics").json()
        adm = admin_client.get(f"{BASE_URL}/api/admin/analytics").json()
        # projects_scoped includes locked OR any-artifacts, so it should be
        # >= locked_projects.
        assert pub["projects_scoped"] >= adm["kpis"]["locked_projects"]


# -- Regression: admin analytics still works after new endpoint added --------
class TestAdminAnalyticsRegression:
    def test_admin_analytics_200(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/analytics")
        assert r.status_code == 200

    def test_admin_users_200(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/users")
        assert r.status_code == 200

    def test_admin_analytics_kpi_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/analytics")
        data = r.json()
        assert "kpis" in data
        for k in ("total_users", "new_users_7d", "total_projects", "locked_projects"):
            assert k in data["kpis"]
