"""Iteration 35 — Full backend regression on the 5-step AI project flow.

Objective (from user): "No error should come anywhere. Run full backend check
to make sure from now on, there should be no error while generating any
steps' responses."

Every step-generation endpoint (situation → context → decision → artifacts →
lock) must respond 200 (or a clean 503+Retry-After under real backpressure).
No 5xx from unhandled exceptions is allowed. This module covers auth, project
creation (paste + upload-brief), all 5 steps, share, unlock/reset, export.md,
export.pdf, /api/suggest, and a small 10-concurrent /api/suggest burst.
"""
from __future__ import annotations
import io
import os
import time
import json
import concurrent.futures as cf
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Frontends .env is the source of truth in this environment.
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip()
                break
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

API = BASE_URL.rstrip("/") + "/api"
LONG_TIMEOUT = 180       # heaviest AI calls (artifacts, one-shot auto-build)
NORMAL_TIMEOUT = 90
SHORT_TIMEOUT = 30

DEMO_EMAIL = "demo@use-bracket.com"
DEMO_PASSWORD = "BracketDemo@2026"

RICH_BRIEF = (
    "Client: Nordwind Coffee Roasters, a Berlin-based specialty coffee chain "
    "with 8 cafes. They want to redesign their retail packaging for their "
    "flagship single-origin line launching in Q2. Current packaging (kraft "
    "bags, hand-stamped) reads too artisanal for the premium price point "
    "(they want to move from EUR 12 to EUR 18/250g). Audience is 30-45 y/o "
    "urban professionals who buy specialty coffee weekly, care about origin "
    "traceability, and follow roasters on Instagram. Constraints: must be "
    "recyclable, must accommodate 3 bag sizes (250g/500g/1kg), print budget "
    "is EUR 22k for the initial run, and the founder wants the visual to "
    "feel closer to a design-object than a grocery product — she referenced "
    "Aesop and Pentagram-era Mast Brothers as directional pulls. She rejects "
    "kraft, illustrations of coffee cherries, and any dark brown palette. "
    "Timeline: hero visual and one bag ready to shoot in 6 weeks, full "
    "range in 10 weeks. Success looks like: the founder proudly hands one "
    "over at trade shows and it drives DTC subscription sign-ups."
)

THIN_BRIEF = "Redesign a coffee bag."  # forces framing-only fallback


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    r = s.post(f"{API}/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
               timeout=SHORT_TIMEOUT)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    assert s.cookies.get("session_token"), "session_token cookie missing"
    return s


@pytest.fixture(scope="module")
def project_id(session):
    """Create a fresh project with a THIN brief so it stays on Step 1 and we
    can exercise each step endpoint in isolation (rather than one-shotting)."""
    r = session.post(f"{API}/projects",
                     json={"project_name": "TEST_iter35_flow",
                           "raw_paste": THIN_BRIEF,
                           "engine": "claude"},
                     timeout=SHORT_TIMEOUT)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid


# ---------------- AUTH ----------------
class TestAuth:
    def test_otp_request_returns_dev_code(self):
        r = requests.post(f"{API}/auth/otp/request",
                          json={"email": "e2e+iter35@example.com"},
                          timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "dev_code" in body, f"OTP_TEST_MODE not returning dev_code: {body}"
        assert isinstance(body["dev_code"], str) and len(body["dev_code"]) >= 4

    def test_otp_verify_sets_session_cookie(self):
        s = requests.Session()
        email = f"e2e+iter35_{int(time.time())}@example.com"
        r = s.post(f"{API}/auth/otp/request", json={"email": email},
                   timeout=SHORT_TIMEOUT)
        code = r.json()["dev_code"]
        r2 = s.post(f"{API}/auth/otp/verify",
                    json={"email": email, "code": code},
                    timeout=SHORT_TIMEOUT)
        assert r2.status_code == 200, r2.text
        assert s.cookies.get("session_token"), "cookie not set on verify"

    def test_password_login(self, session):
        r = session.get(f"{API}/auth/me", timeout=SHORT_TIMEOUT)
        assert r.status_code == 200
        # /auth/me returns the user object at the top level (not wrapped).
        me = r.json()
        assert me.get("email") == DEMO_EMAIL, f"me={me}"

    def test_guest_session(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/guest", json={}, timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, r.text
        assert s.cookies.get("session_token"), "guest cookie missing"
        me = s.get(f"{API}/auth/me", timeout=SHORT_TIMEOUT)
        assert me.status_code == 200
        assert me.json().get("is_guest") is True


# ---------------- SUGGEST ----------------
class TestSuggest:
    def test_suggest_returns_list(self):
        r = requests.post(f"{API}/suggest",
                          json={"step": 1, "field": "what",
                                "partial": "Redesign a bev",
                                "context": {}},
                          timeout=NORMAL_TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "suggestions" in body
        assert isinstance(body["suggestions"], list)


# ---------------- FULL 5-STEP FLOW ----------------
class TestStepFlow:
    """Runs steps 1→2→3→4→5 in order against ONE project. All must be 2xx."""

    def test_step1_situation_framing_only(self, session, project_id):
        # Thin brief → framing-only path (should NOT auto-advance to step 5).
        r = session.post(
            f"{API}/projects/{project_id}/situation",
            json={"what": "Redesign flagship coffee retail packaging",
                  "who": "Berlin specialty coffee roaster moving upmarket",
                  "unclear": "Should the design lean editorial or object-like?",
                  "raw_paste": THIN_BRIEF},
            timeout=NORMAL_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        assert p["framing"] is not None, "framing missing after step 1"
        assert isinstance(p["framing"], dict) and p["framing"], "framing empty"
        # Thin brief should leave us on step 2 (framing done, not one-shot).
        assert p["step"] >= 2, f"step didnt advance: {p['step']}"

    def test_step2_context(self, session, project_id):
        r = session.post(
            f"{API}/projects/{project_id}/context",
            json={
                "requirements": "Recyclable substrate; 3 SKU sizes 250/500/1000g; premium retail shelf presence",
                "constraints": "EUR 22k print budget; 6-week hero deadline; no kraft, no cherries, no dark brown",
                "inspirations": "Aesop bottle language; Mast Brothers geometric era; editorial monospaced type",
            },
            timeout=NORMAL_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        assert p["context"] is not None, "context missing"
        assert isinstance(p["context"], dict) and p["context"]
        assert p["step"] >= 3

    def test_step3_decision(self, session, project_id):
        r = session.post(
            f"{API}/projects/{project_id}/decision",
            json={
                "optimizing_for": "Perceived-value uplift that supports the EUR12 -> EUR18 move without alienating the current buyer",
                "tradeoffs": "Editorial minimalism reads premium but can feel cold; object-language builds shelf ID but risks looking generic",
                "risks": "If the visual is too austere the founders 'proudly hand it over' test fails; if too warm it echoes the old kraft era",
            },
            timeout=NORMAL_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        assert p["decision"] is not None, "decision missing"
        assert isinstance(p["decision"], dict) and p["decision"]
        assert p["step"] >= 4

    def test_step4_artifacts(self, session, project_id):
        # Heaviest AI call — give it the long timeout.
        r = session.post(
            f"{API}/projects/{project_id}/artifacts",
            timeout=LONG_TIMEOUT,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:600]}"
        p = r.json()
        assert p["artifacts"] is not None, "artifacts missing"
        assert isinstance(p["artifacts"], dict) and p["artifacts"]
        assert p["step"] >= 5

    def test_step5_lock(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/lock",
                         timeout=NORMAL_TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        assert p["status"] == "locked", f"status={p['status']}"
        assert p.get("locked_at"), "locked_at missing"


# ---------------- UNLOCK / RESET / SHARE / EXPORT ----------------
class TestPostLockOps:
    def test_unlock_after_lock(self, session, project_id):
        r = session.post(f"{API}/projects/{project_id}/unlock",
                         timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        p = r.json()
        assert p["status"] != "locked"

    def test_reset_from_step(self, session, project_id):
        # Should succeed while project is NOT shared with client.
        r = session.post(f"{API}/projects/{project_id}/reset-from-step/3",
                         timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text}"

    def test_share_conflict_after_share(self, session):
        """Complete a fresh project → share → unlock/reset must 409 (not 5xx)."""
        # Reuse: create small project, situation, then artificially move to
        # sharable state via full flow would be expensive; instead we just
        # verify the 409 path exists on a project that is not yet artifact'd.
        pass  # covered in test_share_link below on the main project id path


# ---------------- SHARE FLOW ----------------
class TestShareFlow:
    def test_share_and_public_get(self, session, project_id):
        # Re-run steps 3+4+lock to get back to shareable state (project was
        # reset above). We only need decision + artifacts populated.
        r = session.post(
            f"{API}/projects/{project_id}/decision",
            json={"optimizing_for": "Uplift", "tradeoffs": "warm vs cold",
                  "risks": "generic risk"},
            timeout=NORMAL_TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        r = session.post(f"{API}/projects/{project_id}/artifacts",
                         timeout=LONG_TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        r = session.post(f"{API}/projects/{project_id}/share",
                         timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, r.text
        p = r.json()
        token = p.get("share_token")
        assert token, "share_token missing after share"

        # Public GET
        rp = requests.get(f"{API}/share/{token}", timeout=SHORT_TIMEOUT)
        assert rp.status_code == 200, rp.text[:300]
        pub = rp.json()
        assert pub.get("id") == project_id or "share_token" not in pub

        # Now unlock/reset must return 409 (project shared with client).
        for path in [f"/projects/{project_id}/unlock",
                     f"/projects/{project_id}/reset-from-step/2"]:
            r = session.post(f"{API}{path}", timeout=SHORT_TIMEOUT)
            assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text[:200]} on {path}"


# ---------------- EXPORTS ----------------
class TestExports:
    def test_export_markdown(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/export.md",
                        timeout=SHORT_TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        assert len(r.text) > 100, "markdown export suspiciously short"

    def test_export_pdf(self, session, project_id):
        r = session.get(f"{API}/projects/{project_id}/export.pdf",
                        timeout=NORMAL_TIMEOUT)
        assert r.status_code == 200, r.text[:300]
        # PDF magic header
        assert r.content[:4] == b"%PDF", "not a valid PDF"


# ---------------- UPLOAD-BRIEF PATH ----------------
class TestUploadBrief:
    def test_upload_txt_brief(self, session):
        files = {
            "file": ("brief.txt", io.BytesIO(RICH_BRIEF.encode()), "text/plain"),
        }
        # Do NOT send Content-Type: application/json here — multipart.
        headers = {k: v for k, v in session.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{API}/projects/upload-brief",
                          files=files, headers=headers,
                          cookies=session.cookies.get_dict(),
                          timeout=LONG_TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        assert p["id"], "no id in upload response"


# ---------------- ONE-SHOT AUTO-BUILD (RICH BRIEF) ----------------
class TestOneShot:
    def test_one_shot_situation_with_rich_brief(self, session):
        # Fresh project so framing is empty (one-shot only fires on first submit).
        rc = session.post(f"{API}/projects",
                          json={"project_name": "TEST_iter35_oneshot",
                                "raw_paste": RICH_BRIEF,
                                "engine": "claude"},
                          timeout=SHORT_TIMEOUT)
        assert rc.status_code == 200
        pid = rc.json()["id"]
        r = session.post(f"{API}/projects/{pid}/situation",
                         json={"raw_paste": RICH_BRIEF},
                         timeout=LONG_TIMEOUT)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        p = r.json()
        # Either one-shot advanced us to 5, or fell back to framing-only (>=2).
        # Both are legal — we only need to confirm no 5xx and framing populated.
        assert p["framing"] is not None, "framing not populated even after one-shot fallback"
        assert p["step"] >= 2, f"step regressed after one-shot: {p['step']}"
        # Log which path we hit — visible in pytest -v output.
        print(f"one-shot path: step={p['step']} auto_advance_status={p.get('auto_advance_status')}")


# ---------------- ERROR HYGIENE ----------------
class TestErrorHygiene:
    def test_invalid_project_id_is_404(self, session):
        r = session.get(f"{API}/projects/does-not-exist-xxxxx",
                        timeout=SHORT_TIMEOUT)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"
        # Must be clean JSON, not HTML/500.
        try:
            body = r.json()
        except Exception:
            pytest.fail(f"non-JSON 404 body: {r.text[:200]}")
        assert "detail" in body

    def test_malformed_body_is_422(self, session):
        r = session.post(f"{API}/suggest",
                         data="not json",
                         headers={"Content-Type": "application/json"},
                         timeout=SHORT_TIMEOUT)
        assert r.status_code in (400, 422), f"expected 4xx, got {r.status_code}"

    def test_step_endpoint_bad_id_404(self, session):
        r = session.post(f"{API}/projects/nope/situation",
                         json={"what": "x", "who": "y", "unclear": "z"},
                         timeout=SHORT_TIMEOUT)
        assert r.status_code == 404, f"got {r.status_code}: {r.text[:200]}"


# ---------------- BACKPRESSURE (10-concurrent /api/suggest) ----------------
class TestBackpressure:
    def test_10_concurrent_suggest_no_5xx(self):
        def one(i: int):
            return requests.post(
                f"{API}/suggest",
                json={"step": 1, "field": "what",
                      "partial": f"design brief {i}",
                      "context": {}},
                timeout=NORMAL_TIMEOUT,
            )
        with cf.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(one, range(10)))
        codes = [r.status_code for r in results]
        print(f"burst codes: {codes}")
        for r in results:
            assert r.status_code in (200, 503), (
                f"unexpected code {r.status_code}: {r.text[:200]}")
            if r.status_code == 503:
                # Backpressure must include Retry-After header.
                assert r.headers.get("Retry-After"), (
                    "503 without Retry-After header — backpressure contract violated")


# ---------------- CLEANUP ----------------
def _cleanup(session):
    """Delete TEST_ projects created by this run so we don't pollute the DB."""
    try:
        r = session.get(f"{API}/projects", timeout=SHORT_TIMEOUT)
        if r.status_code != 200:
            return
        for p in r.json():
            if (p.get("name") or "").startswith("TEST_iter35"):
                session.delete(f"{API}/projects/{p['id']}", timeout=SHORT_TIMEOUT)
    except Exception:
        pass


@pytest.fixture(scope="module", autouse=True)
def _teardown(session):
    yield
    _cleanup(session)
