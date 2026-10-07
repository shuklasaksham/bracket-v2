"""Backend tests for the paste-anything UX overhaul (Steps 1/2/3).

Verifies:
- POST /api/projects/{id}/situation | /context | /decision accept raw_paste and
  extract structured fields via Haiku, storing BOTH raw_paste and extracted
  fields.
- Backwards compat: legacy structured-fields-only payload still returns 200 and
  is used as-is.
- Regression: Step 4 (artifacts) and Step 5 (lock/confidence) still work when
  Steps 1-3 were completed via raw_paste.
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://design-decided.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# --- Sample messy pastes (WhatsApp / email flavored) ---
SITUATION_PASTE = (
    "Hey! So we're an Indian D2C skincare brand launching a new range of "
    "vitamin C serums next month. Founder just DM'd me on WhatsApp — she "
    "wants a full brand refresh AND a Shopify site AND social launch assets "
    "in 5 weeks, budget ~₹2L. Honestly not sure if this is a rebrand or a "
    "launch campaign. Their existing logo is fine imo. Audience is "
    "urban Indian women 22-35, tier-1 cities. Something feels off — do they "
    "even need a rebrand or are they just anxious about the launch?"
)

CONTEXT_PASTE = (
    "Requirements: Shopify site, 6 product PDPs, 12 launch social posts, "
    "1 explainer video. Constraints: budget ₹2L, team is just me + a "
    "junior designer, deadline 5 weeks, brand guidelines don't exist yet. "
    "References: Dot & Key website, Minimalist packaging, The Ordinary's "
    "product page tone. Founder loves the Glossier vibe but wants Indian "
    "warmth. No stock photography allowed."
)

DECISION_PASTE = (
    "I want to optimise for speed to launch, not perfect brand polish. "
    "Willing to trade off: custom photography (use founder-shot lifestyle), "
    "custom illustrations (use type-only), a fancy hero video. Non-negotiable: "
    "mobile experience has to work day 1, product pages need INR pricing "
    "clarity, the launch social posts must ship on time. Worried the founder "
    "will push back on skipping the video and about looking too minimal."
)


@pytest.fixture(scope="module")
def guest_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/guest", timeout=15)
    assert r.status_code == 200, f"/auth/guest failed: {r.status_code} {r.text[:300]}"
    # httpOnly session_token cookie should be set
    assert s.cookies.get("session_token"), "session_token cookie not set on /auth/guest"
    return s


@pytest.fixture
def project_id(guest_session):
    r = guest_session.post(
        f"{API}/projects",
        json={"project_name": f"TEST_paste_{int(time.time())}", "engine": "claude"},
        timeout=15,
    )
    assert r.status_code == 200, f"/projects create failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "id" in data
    return data["id"]


# ---------- Step 1: situation (raw_paste) ----------
class TestSituationPaste:
    def test_situation_raw_paste_extracts_and_stores(self, guest_session, project_id):
        r = guest_session.post(
            f"{API}/projects/{project_id}/situation",
            json={"raw_paste": SITUATION_PASTE},
            timeout=90,
        )
        assert r.status_code == 200, f"situation raw_paste: {r.status_code} {r.text[:400]}"
        data = r.json()
        # Framing produced
        assert data.get("framing"), "framing missing"
        framing = data["framing"]
        assert framing.get("reframed_problem"), "reframed_problem missing"
        cs = framing.get("clarity_score")
        assert isinstance(cs, (int, float)) and 0 <= cs <= 100, f"clarity_score bad: {cs}"

        # situation_input contains BOTH raw_paste and extracted fields
        si = data.get("situation_input") or {}
        assert si.get("raw_paste") == SITUATION_PASTE, "raw_paste not persisted"
        # At least ONE of what/who/unclear must be non-empty after extraction
        extracted_bits = [(si.get("what") or "").strip(), (si.get("who") or "").strip(), (si.get("unclear") or "").strip()]
        assert any(extracted_bits), f"no extracted fields non-empty: {extracted_bits}"
        # step advanced to at least 2
        assert data.get("step", 0) >= 2, f"step not advanced: {data.get('step')}"

    def test_situation_legacy_structured_still_works(self, guest_session):
        # Fresh project so we don't cross-contaminate
        r = guest_session.post(
            f"{API}/projects",
            json={"project_name": f"TEST_legacy_{int(time.time())}", "engine": "claude"},
            timeout=15,
        )
        assert r.status_code == 200
        pid = r.json()["id"]

        legacy_payload = {
            "what": "A landing page for a solo yoga instructor in Bengaluru.",
            "who": "Working women 25-45 in South Bengaluru who want early morning classes.",
            "unclear": "Not sure whether to focus on trial-class booking or subscription.",
        }
        r2 = guest_session.post(
            f"{API}/projects/{pid}/situation",
            json=legacy_payload,
            timeout=90,
        )
        assert r2.status_code == 200, f"legacy situation: {r2.status_code} {r2.text[:400]}"
        d = r2.json()
        assert d.get("framing", {}).get("reframed_problem"), "no framing on legacy path"
        si = d.get("situation_input") or {}
        # No raw_paste stored on legacy path
        assert not si.get("raw_paste"), f"raw_paste unexpectedly stored on legacy: {si.get('raw_paste')}"
        # Fields preserved as-is
        assert si.get("what") == legacy_payload["what"]
        assert si.get("who") == legacy_payload["who"]
        assert si.get("unclear") == legacy_payload["unclear"]


# ---------- Full-flow project (module-scoped) so we can chain 1->2->3->4->5 ----------
@pytest.fixture(scope="module")
def flow_project(guest_session):
    """Create + complete steps 1, 2, 3 via raw_paste. Return the final project dict."""
    # create
    r = guest_session.post(
        f"{API}/projects",
        json={"project_name": f"TEST_flow_{int(time.time())}", "engine": "claude"},
        timeout=15,
    )
    assert r.status_code == 200
    pid = r.json()["id"]

    # step 1
    r1 = guest_session.post(f"{API}/projects/{pid}/situation", json={"raw_paste": SITUATION_PASTE}, timeout=90)
    assert r1.status_code == 200, f"step1 failed: {r1.status_code} {r1.text[:400]}"

    # step 2
    r2 = guest_session.post(f"{API}/projects/{pid}/context", json={"raw_paste": CONTEXT_PASTE}, timeout=90)
    assert r2.status_code == 200, f"step2 failed: {r2.status_code} {r2.text[:400]}"

    # step 3
    r3 = guest_session.post(f"{API}/projects/{pid}/decision", json={"raw_paste": DECISION_PASTE}, timeout=90)
    assert r3.status_code == 200, f"step3 failed: {r3.status_code} {r3.text[:400]}"

    return {"session": guest_session, "pid": pid, "step3": r3.json()}


class TestContextPaste:
    def test_context_raw_paste_stored_and_extracted(self, flow_project):
        s = flow_project["session"]
        pid = flow_project["pid"]
        r = s.get(f"{API}/projects/{pid}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("context"), "context (compressed) missing"
        assert d["context"].get("what_actually_matters"), "what_actually_matters missing"

        ci = d.get("context_input") or {}
        assert ci.get("raw_paste") == CONTEXT_PASTE, "context raw_paste not persisted"
        extracted = [(ci.get("requirements") or "").strip(), (ci.get("constraints") or "").strip(), (ci.get("inspirations") or "").strip()]
        assert any(extracted), f"no context fields extracted: {extracted}"
        assert d.get("step", 0) >= 3

    def test_context_legacy_structured_still_works(self, guest_session):
        # Fresh project, complete step 1 quickly via legacy path
        pid = guest_session.post(
            f"{API}/projects",
            json={"project_name": f"TEST_ctx_legacy_{int(time.time())}"},
            timeout=15,
        ).json()["id"]
        guest_session.post(
            f"{API}/projects/{pid}/situation",
            json={"what": "Landing page", "who": "yoga clients", "unclear": "focus"},
            timeout=90,
        )
        legacy = {
            "requirements": "Booking form, INR pricing, class schedule.",
            "constraints": "Budget ₹40k, 3 weeks, no dev help.",
            "inspirations": "Cult.fit landing page tone.",
        }
        r = guest_session.post(f"{API}/projects/{pid}/context", json=legacy, timeout=90)
        assert r.status_code == 200, f"legacy context: {r.status_code} {r.text[:400]}"
        ci = r.json().get("context_input") or {}
        assert not ci.get("raw_paste")
        assert ci.get("requirements") == legacy["requirements"]


class TestDecisionPaste:
    def test_decision_raw_paste_stored_and_extracted(self, flow_project):
        d = flow_project["step3"]
        assert d.get("decision"), "decision missing"
        rec = d["decision"].get("recommendation") or {}
        assert rec.get("title"), "recommendation.title missing"
        assert rec.get("rationale"), "recommendation.rationale missing"

        di = d.get("decision_input") or {}
        assert di.get("raw_paste") == DECISION_PASTE
        extracted = [(di.get("optimizing_for") or "").strip(), (di.get("tradeoffs") or "").strip(), (di.get("risks") or "").strip()]
        assert any(extracted), f"no decision fields extracted: {extracted}"
        assert d.get("step", 0) >= 4


# ---------- Regression: Step 4 + Step 5 ----------
class TestArtifactsAndLockRegression:
    def test_step4_artifacts_still_generates(self, flow_project):
        s = flow_project["session"]
        pid = flow_project["pid"]
        r = s.post(f"{API}/projects/{pid}/artifacts", timeout=90)
        assert r.status_code == 200, f"artifacts: {r.status_code} {r.text[:400]}"
        d = r.json()
        art = d.get("artifacts") or {}
        assert art.get("scope_doc"), "scope_doc missing"
        assert art.get("client_message"), "client_message missing"
        assert d.get("step", 0) >= 5

    def test_step5_lock_still_works(self, flow_project):
        s = flow_project["session"]
        pid = flow_project["pid"]
        # Confidence lock endpoint takes no body — just posts
        r = s.post(f"{API}/projects/{pid}/lock", timeout=30)
        assert r.status_code == 200, f"lock: {r.status_code} {r.text[:400]}"
        d = r.json()
        assert d.get("status") == "locked", f"status not locked: {d.get('status')}"
        assert d.get("locked_at"), "locked_at missing after lock"


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(guest_session):
    yield
    # Delete every TEST_* project we created for this session.
    try:
        r = guest_session.get(f"{API}/projects", timeout=15)
        if r.status_code == 200:
            projects = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
            for p in projects:
                if (p.get("name") or "").startswith("TEST_"):
                    try:
                        guest_session.delete(f"{API}/projects/{p['id']}", timeout=10)
                    except Exception:
                        pass
    except Exception:
        pass
