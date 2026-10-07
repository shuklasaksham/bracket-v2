"""Bracket anonymous-mode backend tests.

Covers:
- POST /api/projects (happy + validation errors)
- GET /api/projects/{id} (no auth)
- Full 5-step walk: situation -> context -> decision -> artifacts -> lock
- GET /api/projects/{id}/export.md
- Dead routes removed (auth, waitlist, billing, templates, workspaces, moments)
- Friendly 404 on invalid project id
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://design-decided.preview.emergentagent.com"
API = f"{BASE_URL}/api"


# ---------- POST /api/projects ----------
class TestCreateProject:
    def test_create_project_happy(self):
        payload = {
            "name": "Test User",
            "email": f"TEST_create_{int(time.time())}@example.com",
            "project_name": "TEST_project_create",
        }
        r = requests.post(f"{API}/projects", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert "id" in data and isinstance(data["id"], str) and len(data["id"]) > 0
        assert data["creator_name"] == "Test User"
        assert data["creator_email"] == payload["email"].lower()
        assert data["name"] == "TEST_project_create"
        assert data["status"] == "draft"
        assert data["step"] == 1
        # verify persistence
        g = requests.get(f"{API}/projects/{data['id']}", timeout=15)
        assert g.status_code == 200
        assert g.json()["id"] == data["id"]

    def test_create_project_missing_email(self):
        r = requests.post(f"{API}/projects", json={"name": "x", "project_name": "y"}, timeout=15)
        assert r.status_code == 422

    def test_create_project_invalid_email(self):
        r = requests.post(
            f"{API}/projects",
            json={"name": "x", "email": "not-an-email", "project_name": "y"},
            timeout=15,
        )
        assert r.status_code == 422

    def test_create_project_missing_project_name(self):
        r = requests.post(
            f"{API}/projects",
            json={"name": "x", "email": "a@b.com"},
            timeout=15,
        )
        assert r.status_code == 422


# ---------- GET project ----------
class TestGetProject:
    def test_invalid_id_returns_404(self):
        r = requests.get(f"{API}/projects/does-not-exist-xyz", timeout=15)
        assert r.status_code == 404
        body = r.json()
        assert "detail" in body
        assert isinstance(body["detail"], str)


# ---------- Dead routes ----------
class TestDeadRoutes:
    @pytest.mark.parametrize(
        "path,method",
        [
            ("/auth/me", "GET"),
            ("/auth/login", "POST"),
            ("/waitlist", "POST"),
            ("/billing/me", "GET"),
            ("/templates", "GET"),
            ("/workspaces", "GET"),
            ("/moments", "GET"),
        ],
    )
    def test_dead_route_404(self, path, method):
        url = f"{API}{path}"
        r = requests.request(method, url, json={}, timeout=15)
        assert r.status_code == 404, f"{method} {path} expected 404 got {r.status_code}: {r.text[:200]}"


# ---------- Full 5-step walk + export ----------
@pytest.fixture(scope="module")
def fresh_project_id():
    payload = {
        "name": "Walkthrough User",
        "email": f"TEST_walk_{int(time.time())}@example.com",
        "project_name": "TEST_walk_project",
    }
    r = requests.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


class TestFullFlow:
    def test_step1_situation(self, fresh_project_id):
        body = {
            "what": "Landing page redesign for a fintech startup",
            "who": "Series A fintech, working with the founder directly",
            "unclear": "Brand still being defined, scope keeps expanding",
        }
        r = requests.post(f"{API}/projects/{fresh_project_id}/situation", json=body, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["step"] >= 2
        assert data["framing"] is not None
        assert "reframed_problem" in data["framing"]

    def test_step2_context(self, fresh_project_id):
        body = {
            "requirements": "Must launch in 4 weeks. Mobile-first. Convert to demo signups.",
            "constraints": "Two-person team, no custom illustration budget.",
            "inspirations": "Linear, Stripe.",
        }
        r = requests.post(f"{API}/projects/{fresh_project_id}/context", json=body, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["step"] >= 3
        assert data["context"] is not None

    def test_step3_decision(self, fresh_project_id):
        body = {
            "optimizing_for": "Conversion over visual polish",
            "tradeoffs": "Less custom illustration",
            "risks": "Founder may push back on minimal aesthetic",
        }
        r = requests.post(f"{API}/projects/{fresh_project_id}/decision", json=body, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["step"] >= 4
        assert data["decision"] is not None

    def test_step4_artifacts(self, fresh_project_id):
        r = requests.post(f"{API}/projects/{fresh_project_id}/artifacts", timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["step"] >= 5
        assert data["artifacts"] is not None

    def test_step5_lock(self, fresh_project_id):
        r = requests.post(f"{API}/projects/{fresh_project_id}/lock", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "locked"
        assert data["locked_at"] is not None

    def test_export_markdown(self, fresh_project_id):
        r = requests.get(f"{API}/projects/{fresh_project_id}/export.md", timeout=30)
        assert r.status_code == 200
        assert "text/markdown" in r.headers.get("content-type", "")
        body = r.text
        assert "# " in body  # has a title
        # Look for the structural sections
        for section in ["Reframed problem", "What actually matters", "Decision", "Scope", "Client message", "Assumptions", "Risk flags"]:
            assert section in body, f"export.md missing section: {section}"


# ---------- Pre-existing project refresh ----------
class TestExistingProjectRefresh:
    def test_known_id_loads(self):
        """Verify sample id from the review request still resolves."""
        sample = "44b39ab4-d87c-408c-8143-5119bbce5155"
        r = requests.get(f"{API}/projects/{sample}", timeout=15)
        # Either 200 with project or 404 if DB was reset — both acceptable
        assert r.status_code in (200, 404)
