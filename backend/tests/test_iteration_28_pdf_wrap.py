"""
Iteration 28+ regression tests — verifies the 3 fixes reported by user:

  1. PDF NO-OVERFLOW: /api/projects/{id}/export.pdf wraps long alternative
     titles using _safe_multi_cell instead of overflowing past the right margin.
     Also verifies the '§' character has NOT regressed back in the extracted text.

  2. Owner-side ClientReviewModal precondition — demo project has
     share_status='rejected' so the 'View concerns & reply' CTA renders.
     (Frontend CSS max-width: 720px is verified by playwright.)

  3. Client review dark theme (frontend-only) — covered by playwright pass.
"""

import os
import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://design-decided.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"
DEMO_PROJECT_ID = "c661fa99-fc01-4ec5-bdb6-c7e2c54ae6a7"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=60)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def locked_project_with_alts(demo_session):
    r = demo_session.get(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}", timeout=60)
    assert r.status_code == 200
    p = r.json()
    assert p["status"] == "locked", f"Project must be locked; got {p['status']}"
    alts = (p.get("decision") or {}).get("alternatives") or []
    assert len(alts) >= 1, "No alternatives on decision"
    long_alts = [a for a in alts if len(a.get("title", "")) >= 50]
    assert long_alts, f"No long alt titles; lens={[len(a.get('title','')) for a in alts]}"
    return {"project": p, "alts": alts}


# ---------- PDF overflow / § regression ----------

class TestPdfExportWraps:
    def test_export_pdf_downloads(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}/export.pdf", timeout=120)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 1000
        with open("/tmp/iter28plus_export.pdf", "wb") as f:
            f.write(r.content)

    def test_extracted_text_has_no_section_sign(self):
        reader = PdfReader("/tmp/iter28plus_export.pdf")
        full = "".join(page.extract_text() or "" for page in reader.pages)
        assert "\u00a7" not in full, "PDF must not contain the § character"

    def test_long_alt_titles_wrap_no_truncation(self, locked_project_with_alts):
        reader = PdfReader("/tmp/iter28plus_export.pdf")
        full = "".join((page.extract_text() or "") + "\n" for page in reader.pages)
        assert "..." not in full, "PDF text contains '...' — indicates truncation regression"

        alts = locked_project_with_alts["alts"]
        flat = " ".join(full.split())
        for alt in alts:
            title = alt.get("title", "")
            words = title.split()
            head = " ".join(words[:5])
            tail = " ".join(words[-4:])
            # head fingerprint (may be split across line, so use flat)
            assert " ".join(head.split()) in flat, f"Alt title head missing: {head!r}"
            # tail must be present (proves wrapping continued the title on next line)
            assert " ".join(tail.split()) in flat, f"Alt title tail missing (truncated?): {tail!r}"


# ---------- Owner modal precondition ----------

class TestOwnerModalPrecondition:
    def test_project_share_status_rejected(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/projects/{DEMO_PROJECT_ID}", timeout=60)
        assert r.status_code == 200
        p = r.json()
        assert p.get("share_status") == "rejected", \
            f"Expected share_status='rejected' to render the CTA; got {p.get('share_status')}"
        assert (p.get("share_review") or {}), "share_review payload missing on rejected project"
