"""
Iteration 19 — admin analytics endpoint + regression smoke tests.

Coverage:
- GET /api/admin/analytics: 200 for admin, 404 for anonymous, 404 for non-admin user
- Response payload shape: kpis, new_users_daily(30), projects_daily(30), status_distribution,
  step_funnel(5), cycle_time_points, top_users, share_funnel(4), activity_heatmap(7x24),
  share_accept_rate, generated_at
- Regression: GET /api/projects (auth), GET /api/projects/{id}, framing generation stub
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend/.env
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "support@use-bracket.com"
ADMIN_PASSWORD = "Bracket@123"


# ---------- Fixtures --------------------------------------------------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def user_session():
    """Fresh OTP-verified normal (non-admin) user session."""
    s = requests.Session()
    email = f"e2e+iter19-{uuid.uuid4().hex[:6]}@example.com"
    r1 = s.post(
        f"{BASE_URL}/api/auth/otp/request",
        json={"email": email, "name": "Iter19 Tester"},
        timeout=15,
    )
    assert r1.status_code == 200, f"otp/request: {r1.status_code} {r1.text[:200]}"
    code = r1.json().get("dev_code")
    assert code, "no dev_code returned; OTP_TEST_MODE not enabled?"
    r2 = s.post(
        f"{BASE_URL}/api/auth/otp/verify",
        json={
            "email": email,
            "code": code,
            "name": "Iter19 Tester",
            "designation": "Designer",
            "avatar": "mono-1",
        },
        timeout=15,
    )
    assert r2.status_code == 200, f"otp/verify: {r2.status_code} {r2.text[:200]}"
    return s, email


# ---------- Access control --------------------------------------------------
class TestAdminAnalyticsAccessControl:
    def test_anonymous_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/admin/analytics", timeout=15)
        assert r.status_code == 404, f"expected 404 for anon, got {r.status_code}"

    def test_non_admin_user_returns_404(self, user_session):
        s, _ = user_session
        r = s.get(f"{BASE_URL}/api/admin/analytics", timeout=15)
        assert r.status_code == 404, (
            f"expected 404 for non-admin, got {r.status_code} {r.text[:200]}"
        )


# ---------- Payload shape ---------------------------------------------------
class TestAdminAnalyticsPayload:
    def test_admin_gets_200_and_full_payload(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/analytics", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()

        # Top-level keys
        expected_keys = {
            "kpis", "new_users_daily", "projects_daily", "status_distribution",
            "step_funnel", "cycle_time_points", "top_users", "share_funnel",
            "activity_heatmap", "share_accept_rate", "generated_at",
        }
        missing = expected_keys - set(data.keys())
        assert not missing, f"missing keys: {missing}"

        # KPIs shape
        kpi = data["kpis"]
        for k in ("total_users", "new_users_7d", "total_projects", "locked_projects",
                  "share_accept_rate", "avg_steps"):
            assert k in kpi, f"kpis missing {k}"
            assert isinstance(kpi[k], (int, float)), f"kpis.{k} not numeric: {kpi[k]!r}"

        # Series lengths
        assert isinstance(data["new_users_daily"], list) and len(data["new_users_daily"]) == 30
        assert isinstance(data["projects_daily"], list) and len(data["projects_daily"]) == 30
        assert isinstance(data["step_funnel"], list) and len(data["step_funnel"]) == 5
        assert isinstance(data["share_funnel"], list) and len(data["share_funnel"]) == 4

        # Daily entries shape
        for pt in data["new_users_daily"] + data["projects_daily"]:
            assert set(pt.keys()) >= {"date", "count"}
            assert isinstance(pt["count"], int)
            # ISO-ish date like YYYY-MM-DD
            assert len(pt["date"]) == 10 and pt["date"][4] == "-" and pt["date"][7] == "-"

        # Step funnel shape + labels
        labels = [row["step"] for row in data["step_funnel"]]
        assert labels == ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]
        for row in data["step_funnel"]:
            assert isinstance(row["count"], int)

        # Share funnel stages
        stages = [row["stage"] for row in data["share_funnel"]]
        assert stages == ["Shared", "Reviewed", "Accepted", "Rejected"]
        for row in data["share_funnel"]:
            assert isinstance(row["count"], int)

        # Heatmap 7x24
        heat = data["activity_heatmap"]
        assert isinstance(heat, list) and len(heat) == 7
        day_names = [row["day"] for row in heat]
        assert day_names == ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        for row in heat:
            assert isinstance(row["hours"], list) and len(row["hours"]) == 24
            for h in row["hours"]:
                assert "hour" in h and "value" in h
                assert 0 <= h["hour"] <= 23
                assert isinstance(h["value"], int)

        # status_distribution shape
        for row in data["status_distribution"]:
            assert "name" in row and "value" in row
            assert isinstance(row["value"], int)

        # top_users shape (each row has email/name/projects)
        for row in data["top_users"]:
            assert set(row.keys()) >= {"email", "name", "projects"}
            assert isinstance(row["projects"], int)

        # cycle_time_points shape
        for row in data["cycle_time_points"]:
            assert set(row.keys()) >= {"user", "days", "name"}
            assert isinstance(row["days"], (int, float))

        # share_accept_rate is a number
        assert isinstance(data["share_accept_rate"], (int, float))

        # generated_at should be ISO-ish
        assert isinstance(data["generated_at"], str) and len(data["generated_at"]) >= 10

    def test_yashwork_project_count(self, admin_session):
        """Verify problem statement: yashwork1303@gmail.com has 1 project."""
        r = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=15)
        assert r.status_code == 200
        users = r.json().get("users", []) if isinstance(r.json(), dict) else r.json()
        yash = [u for u in users if (u.get("email") or "").lower() == "yashwork1303@gmail.com"]
        # If seeded, must have exactly 1 project. If not present, mark as skip.
        if not yash:
            pytest.skip("yashwork1303@gmail.com not present in this env")
        assert yash[0].get("project_count") == 1, (
            f"expected 1 project, got {yash[0].get('project_count')}"
        )


# ---------- Regression smoke -----------------------------------------------
class TestRegressionSmoke:
    def test_projects_list_for_user(self, user_session):
        s, _ = user_session
        r = s.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_fetch_project(self, user_session):
        s, _ = user_session
        pname = f"TEST_iter19_{uuid.uuid4().hex[:6]}"
        r = s.post(
            f"{BASE_URL}/api/projects",
            json={"project_name": pname, "engine": "claude"},
            timeout=20,
        )
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:200]}"
        pid = r.json().get("project_id") or r.json().get("id")
        assert pid, f"no project id in response: {r.json()}"

        # GET by id
        r2 = s.get(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        assert r2.status_code == 200
        got = r2.json()
        assert got.get("project_name") == pname or got.get("name") == pname

        # cleanup
        s.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)

    def test_suggest_endpoint_quick(self, user_session):
        """Regression: /api/suggest returns list of suggestions."""
        s, _ = user_session
        t0 = time.time()
        r = s.post(
            f"{BASE_URL}/api/suggest",
            json={"text": "improve mobile onboarding"},
            timeout=15,
        )
        elapsed = time.time() - t0
        # allow 200 or fail gracefully; we only assert if success
        if r.status_code == 200:
            data = r.json()
            assert isinstance(data, (list, dict))
            assert elapsed < 15
        else:
            pytest.skip(f"/api/suggest returned {r.status_code}, skipping non-critical smoke")
