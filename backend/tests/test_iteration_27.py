"""
Iteration 27 tests — Mandatory client_email + PDF §-removal + persistence.

Covers:
  1. PDF should NOT contain '§' character in extracted text (uses pypdf)
  2. POST /api/share/{token}/accept requires client_email (422 if missing / invalid)
  3. POST /api/share/{token}/reject/confirm requires client_email
  4. Persistence: project.share_review.client_email is stored lowercased/trimmed
"""

import os
import copy
import pytest
import requests
from pymongo import MongoClient
from pypdf import PdfReader
from io import BytesIO

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://design-decided.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bracket_db")

DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"demo login failed {r.status_code}: {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def demo_project_id(owner_session):
    r = owner_session.get(f"{BASE_URL}/api/projects", timeout=30)
    projects = r.json()
    assert projects, "demo has no projects"
    # Pick project with artifacts
    for p in projects:
        pid = p["id"]
        d = owner_session.get(f"{BASE_URL}/api/projects/{pid}", timeout=30).json()
        if d.get("artifacts") and d["artifacts"].get("scope_doc"):
            return pid
    return projects[0]["id"]


@pytest.fixture
def resettable_project(mongo_db, demo_project_id):
    """Backup share_status/share_review before test, restore after — so we can
    exercise the accept/reject endpoints without permanently mutating the demo
    project."""
    original = mongo_db.projects.find_one({"id": demo_project_id})
    assert original, "project not found"
    original_snapshot = {
        "share_status": original.get("share_status"),
        "share_review": original.get("share_review"),
        "share_token": original.get("share_token"),
    }
    # Force to 'sent' so accept/reject endpoints don't 409
    mongo_db.projects.update_one(
        {"id": demo_project_id},
        {"$set": {"share_status": "sent"}, "$unset": {"share_review": ""}},
    )
    doc = mongo_db.projects.find_one({"id": demo_project_id})
    yield {"id": demo_project_id, "share_token": doc.get("share_token")}
    # Restore
    unset = {}
    setp = {"share_status": original_snapshot["share_status"]}
    if original_snapshot["share_review"] is not None:
        setp["share_review"] = original_snapshot["share_review"]
    else:
        unset["share_review"] = ""
    op = {"$set": setp}
    if unset:
        op["$unset"] = unset
    mongo_db.projects.update_one({"id": demo_project_id}, op)


# ---------- 1. PDF § removal (text-level) ----------
class TestPdfNoSection:
    def test_pdf_export_extracted_text_has_no_section_glyph(self, owner_session, demo_project_id):
        r = owner_session.get(f"{BASE_URL}/api/projects/{demo_project_id}/export.pdf", timeout=60)
        assert r.status_code == 200, f"PDF export failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        pdf = r.content
        assert pdf.startswith(b"%PDF")
        reader = PdfReader(BytesIO(pdf))
        full = "".join((p.extract_text() or "") for p in reader.pages)
        assert len(full) > 200, f"extracted text too short: {len(full)}"
        assert "\u00a7" not in full, "PDF extracted text still contains § (U+00A7)"

    def test_pdf_still_has_section_headings(self, owner_session, demo_project_id):
        r = owner_session.get(f"{BASE_URL}/api/projects/{demo_project_id}/export.pdf", timeout=60)
        assert r.status_code == 200
        reader = PdfReader(BytesIO(r.content))
        full = "".join((p.extract_text() or "") for p in reader.pages)
        up = full.upper()
        # SCOPE is universally present for any locked project
        assert "SCOPE" in up, "PDF is missing 'SCOPE' section heading"


# ---------- 2. client_email validation ----------
class TestClientEmailValidation:
    def test_accept_missing_email_returns_422(self, resettable_project):
        token = resettable_project["share_token"]
        r = requests.post(
            f"{BASE_URL}/api/share/{token}/accept",
            json={
                "acceptances": {"a": True},
                "signature_name": "Test User",
                "role": "",
            },
            timeout=30,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:300]}"
        text = r.text.lower()
        assert "client_email" in text or "field required" in text or "missing" in text

    def test_accept_invalid_email_returns_422(self, resettable_project):
        token = resettable_project["share_token"]
        r = requests.post(
            f"{BASE_URL}/api/share/{token}/accept",
            json={
                "acceptances": {"a": True},
                "signature_name": "Test User",
                "role": "",
                "client_email": "not-an-email",
            },
            timeout=30,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:300]}"
        assert "email" in r.text.lower()

    def test_reject_missing_email_returns_422(self, resettable_project):
        token = resettable_project["share_token"]
        r = requests.post(
            f"{BASE_URL}/api/share/{token}/reject/confirm",
            json={
                "concerns": "This is a long enough concern to pass validation.",
                "signature_name": "Test User",
                "role": "",
            },
            timeout=30,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:300]}"

    def test_reject_invalid_email_returns_422(self, resettable_project):
        token = resettable_project["share_token"]
        r = requests.post(
            f"{BASE_URL}/api/share/{token}/reject/confirm",
            json={
                "concerns": "This is a long enough concern to pass validation.",
                "signature_name": "Test User",
                "role": "",
                "client_email": "not-an-email",
            },
            timeout=30,
        )
        assert r.status_code == 422
        assert "email" in r.text.lower()


# ---------- 3. Persistence (lowercased/trimmed) ----------
class TestClientEmailPersistence:
    def test_accept_persists_email_lowercased(self, owner_session, resettable_project):
        pid = resettable_project["id"]
        token = resettable_project["share_token"]
        payload = {
            "acceptances": {"item_a": True, "item_b": True},
            "signature_name": "TEST_ Acceptor",
            "role": "QA",
            "client_email": "  TEST-Accept@Example.COM  ",
        }
        r = requests.post(f"{BASE_URL}/api/share/{token}/accept", json=payload, timeout=60)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body.get("share_status") == "accepted"
        detail = owner_session.get(f"{BASE_URL}/api/projects/{pid}", timeout=30).json()
        review = detail.get("share_review") or {}
        assert review.get("client_email") == "test-accept@example.com", (
            f"expected lowercased/trimmed, got {review.get('client_email')!r}"
        )

    def test_reject_persists_email_lowercased(self, owner_session, resettable_project):
        pid = resettable_project["id"]
        token = resettable_project["share_token"]
        payload = {
            "concerns": "The scope looks bloated — we need to trim deliverables.",
            "signature_name": "TEST_ Rejector",
            "role": "PM",
            "client_email": "  TEST-Reject@Example.COM  ",
            "ai_suggestions": {},
        }
        r = requests.post(f"{BASE_URL}/api/share/{token}/reject/confirm", json=payload, timeout=60)
        assert r.status_code == 200, f"reject failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body.get("share_status") == "rejected"
        detail = owner_session.get(f"{BASE_URL}/api/projects/{pid}", timeout=30).json()
        review = detail.get("share_review") or {}
        assert review.get("client_email") == "test-reject@example.com", (
            f"expected lowercased/trimmed, got {review.get('client_email')!r}"
        )
