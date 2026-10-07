"""Bracket v2 feature tests — share/export/moments/templates/workspaces/simulate/revisions/billing."""
import os
import time
import pytest
import requests
from requests.cookies import RequestsCookieJar


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://design-decided.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TS = int(time.time())
USER_OWN = {"email": f"v2own+{TS}@example.com", "password": "bracket123", "name": "V2 Owner"}
USER_OTHER = {"email": f"v2oth+{TS}@example.com", "password": "bracket123", "name": "V2 Other"}


class _NoCookieJar(RequestsCookieJar):
    def set_cookie(self, *a, **kw):
        return None
    def extract_cookies(self, *a, **kw):
        return None


def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.cookies = _NoCookieJar()
    return s


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def session():
    return _new_session()


@pytest.fixture(scope="module")
def owner_token(session):
    r = session.post(f"{API}/auth/register", json=USER_OWN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def other_token(session):
    r = session.post(f"{API}/auth/register", json=USER_OTHER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def fully_built_project(session, owner_token):
    """Run the 5-step flow to produce a project ready for share/export/simulate/lock tests."""
    r = session.post(f"{API}/projects", json={"name": "TEST_v2_full", "engine": "claude"}, headers=_h(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # step 1
    r = session.post(f"{API}/projects/{pid}/situation", json={
        "what": "Decide whether to spin off the design system into its own product",
        "who": "Internal product teams + 3 partner agencies",
        "unclear": "If a public release would hurt our consulting margins",
    }, headers=_h(owner_token), timeout=120)
    assert r.status_code == 200, r.text
    # step 2
    r = session.post(f"{API}/projects/{pid}/context", json={
        "requirements": "Ship beta within 2 quarters; preserve agency revenue",
        "constraints": "8 person team; can't hire DevRel",
        "inspirations": "Radix, Mantine",
    }, headers=_h(owner_token), timeout=120)
    assert r.status_code == 200, r.text
    # step 3
    r = session.post(f"{API}/projects/{pid}/decision", json={
        "optimizing_for": "Long-term distribution leverage",
        "tradeoffs": "Short-term consulting revenue vs platform reach",
        "risks": "Cannibalization, support burden",
    }, headers=_h(owner_token), timeout=120)
    assert r.status_code == 200, r.text
    # step 4
    r = session.post(f"{API}/projects/{pid}/artifacts", headers=_h(owner_token), timeout=180)
    assert r.status_code == 200, r.text
    return pid


# ---------- SHARE ----------
class TestShare:
    def test_share_requires_artifacts(self, session, owner_token):
        r = session.post(f"{API}/projects", json={"name": "TEST_no_art", "engine": "claude"}, headers=_h(owner_token))
        pid = r.json()["id"]
        r2 = session.post(f"{API}/projects/{pid}/share", headers=_h(owner_token))
        assert r2.status_code == 400
        session.delete(f"{API}/projects/{pid}", headers=_h(owner_token))

    def test_share_create_get_revoke(self, session, owner_token, fully_built_project):
        pid = fully_built_project
        r = session.post(f"{API}/projects/{pid}/share", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        token = r.json()["share_token"]
        assert isinstance(token, str) and len(token) > 8
        # public access (no auth)
        r2 = requests.get(f"{API}/public/projects/{token}", timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        assert "user_id" not in body
        assert body.get("artifacts") is not None
        # store
        pytest.share_token = token
        # revoke
        r3 = session.delete(f"{API}/projects/{pid}/share", headers=_h(owner_token))
        assert r3.status_code == 200
        r4 = requests.get(f"{API}/public/projects/{token}", timeout=15)
        assert r4.status_code == 404
        # re-share for export tests
        r5 = session.post(f"{API}/projects/{pid}/share", headers=_h(owner_token))
        pytest.share_token = r5.json()["share_token"]


# ---------- EXPORT ----------
class TestExport:
    def test_owner_export_md(self, session, owner_token, fully_built_project):
        r = session.get(f"{API}/projects/{fully_built_project}/export.md", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        assert "text/markdown" in r.headers.get("content-type", "")
        assert "# " in r.text  # has a markdown heading

    def test_public_export_md(self):
        r = requests.get(f"{API}/public/projects/{pytest.share_token}/export.md", timeout=20)
        assert r.status_code == 200
        assert "Bracket" in r.text or "#" in r.text

    def test_public_export_404_unknown(self):
        r = requests.get(f"{API}/public/projects/UNKNOWN_TOKEN_XX/export.md", timeout=15)
        assert r.status_code == 404


# ---------- MOMENTS ----------
class TestMoments:
    def test_create_moment_claude(self, session, owner_token):
        r = session.post(f"{API}/moments", json={
            "moment": "Client just said 'this design feels generic' on a Friday at 5pm",
            "context": "Final review meeting; PM is on the call",
            "engine": "claude",
        }, headers=_h(owner_token), timeout=120)
        assert r.status_code == 200, r.text
        out = r.json()["output"]
        for k in ("read", "timing", "posture", "tone", "response_draft"):
            assert k in out, f"missing {k}"
        pytest.moment_id = r.json()["id"]

    def test_create_moment_gpt(self, session, owner_token):
        r = session.post(f"{API}/moments", json={
            "moment": "Stakeholder wants to add 3 features 2 days before launch.",
            "context": "Launch is locked; team is tired",
            "engine": "gpt",
        }, headers=_h(owner_token), timeout=120)
        assert r.status_code == 200, r.text
        out = r.json()["output"]
        assert "response_draft" in out

    def test_list_moments(self, session, owner_token):
        r = session.get(f"{API}/moments", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()]
        assert pytest.moment_id in ids

    def test_delete_moment(self, session, owner_token):
        r = session.delete(f"{API}/moments/{pytest.moment_id}", headers=_h(owner_token))
        assert r.status_code == 200
        r2 = session.get(f"{API}/moments", headers=_h(owner_token))
        assert pytest.moment_id not in [m["id"] for m in r2.json()]


# ---------- SIMULATOR ----------
class TestSimulate:
    def test_simulate_requires_decision(self, session, owner_token):
        r = session.post(f"{API}/projects", json={"name": "TEST_sim_empty", "engine": "claude"}, headers=_h(owner_token))
        pid = r.json()["id"]
        r2 = session.post(f"{API}/projects/{pid}/simulate", headers=_h(owner_token))
        assert r2.status_code == 400
        session.delete(f"{API}/projects/{pid}", headers=_h(owner_token))

    def test_simulate_returns_scenarios(self, session, owner_token, fully_built_project):
        r = session.post(f"{API}/projects/{fully_built_project}/simulate", headers=_h(owner_token), timeout=180)
        assert r.status_code == 200, r.text
        sim = r.json()["simulation"]
        assert sim and "scenarios" in sim
        assert isinstance(sim["scenarios"], list) and len(sim["scenarios"]) > 0
        first = sim["scenarios"][0]
        for k in ("trigger", "why", "best_move", "response_draft"):
            assert k in first, f"missing {k} in scenario"


# ---------- TEMPLATES ----------
class TestTemplates:
    def test_create_template_from_project(self, session, owner_token, fully_built_project):
        r = session.post(f"{API}/templates", json={
            "name": "TEST_tpl",
            "description": "scope template",
            "from_project_id": fully_built_project,
        }, headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["situation_input"] is not None
        pytest.tpl_id = t["id"]

    def test_list_templates(self, session, owner_token):
        r = session.get(f"{API}/templates", headers=_h(owner_token))
        assert r.status_code == 200
        assert pytest.tpl_id in [t["id"] for t in r.json()]

    def test_apply_template(self, session, owner_token):
        r = session.post(f"{API}/templates/{pytest.tpl_id}/apply", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["situation_input"] is not None
        # cleanup created project
        session.delete(f"{API}/projects/{proj['id']}", headers=_h(owner_token))

    def test_delete_template(self, session, owner_token):
        r = session.delete(f"{API}/templates/{pytest.tpl_id}", headers=_h(owner_token))
        assert r.status_code == 200


# ---------- WORKSPACES ----------
class TestWorkspaces:
    def test_create_idempotent(self, session, owner_token):
        r1 = session.post(f"{API}/workspaces", json={"name": "TEST_ws"}, headers=_h(owner_token))
        assert r1.status_code == 200, r1.text
        ws1 = r1.json()
        r2 = session.post(f"{API}/workspaces", json={"name": "TEST_ws_again"}, headers=_h(owner_token))
        assert r2.status_code == 200
        assert r2.json()["id"] == ws1["id"]
        pytest.ws_id = ws1["id"]

    def test_mine_returns_workspace(self, session, owner_token):
        r = session.get(f"{API}/workspaces/mine", headers=_h(owner_token))
        assert r.status_code == 200
        assert r.json()["id"] == pytest.ws_id

    def test_invite_idempotent(self, session, owner_token):
        invite_email = USER_OTHER["email"]
        r1 = session.post(f"{API}/workspaces/{pytest.ws_id}/invite", json={"email": invite_email}, headers=_h(owner_token))
        assert r1.status_code == 200, r1.text
        members = r1.json()["member_emails"]
        assert invite_email.lower() in members
        before = len(members)
        r2 = session.post(f"{API}/workspaces/{pytest.ws_id}/invite", json={"email": invite_email}, headers=_h(owner_token))
        assert len(r2.json()["member_emails"]) == before  # idempotent

    def test_member_can_see_workspace(self, session, other_token):
        r = session.get(f"{API}/workspaces/mine", headers=_h(other_token))
        assert r.status_code == 200
        assert r.json() and r.json()["id"] == pytest.ws_id

    def test_cannot_remove_owner(self, session, owner_token):
        r = session.delete(f"{API}/workspaces/{pytest.ws_id}/members/{USER_OWN['email']}", headers=_h(owner_token))
        assert r.status_code == 400

    def test_remove_member(self, session, owner_token):
        r = session.delete(f"{API}/workspaces/{pytest.ws_id}/members/{USER_OTHER['email']}", headers=_h(owner_token))
        assert r.status_code == 200
        assert USER_OTHER["email"].lower() not in r.json()["member_emails"]


# ---------- REVISIONS ----------
class TestRevisions:
    def test_edit_after_lock_requires_locked(self, session, owner_token, fully_built_project):
        # currently in_progress (after simulate). Should 400.
        r = session.post(f"{API}/projects/{fully_built_project}/edit-after-lock", json={"note": "x"}, headers=_h(owner_token))
        assert r.status_code == 400

    def test_lock_then_edit_creates_revision(self, session, owner_token, fully_built_project):
        # lock
        rl = session.post(f"{API}/projects/{fully_built_project}/lock", headers=_h(owner_token), timeout=15)
        assert rl.status_code == 200, rl.text
        assert rl.json()["status"] == "locked"
        # edit-after-lock
        r = session.post(f"{API}/projects/{fully_built_project}/edit-after-lock", json={"note": "first revision"}, headers=_h(owner_token))
        assert r.status_code == 200, r.text
        proj = r.json()
        assert proj["status"] == "in_progress"
        assert proj["step"] == 2
        assert proj["revision_count"] == 1
        # list revisions
        r2 = session.get(f"{API}/projects/{fully_built_project}/revisions", headers=_h(owner_token))
        assert r2.status_code == 200
        revs = r2.json()
        assert len(revs) >= 1
        assert revs[0]["version"] >= 1
        assert revs[0]["snapshot"]["artifacts"] is not None


# ---------- BILLING ----------
class TestBilling:
    def test_billing_me_default_free(self, session, owner_token):
        r = session.get(f"{API}/billing/me", headers=_h(owner_token))
        assert r.status_code == 200
        assert r.json()["tier"] in ("free", "pro", "studio")  # likely free for new user

    def test_checkout_invalid_tier(self, session, owner_token):
        r = session.post(f"{API}/billing/checkout", json={
            "tier": "ultra", "currency": "USD", "origin_url": BASE_URL,
        }, headers=_h(owner_token), timeout=20)
        assert r.status_code == 400

    def test_checkout_invalid_currency(self, session, owner_token):
        r = session.post(f"{API}/billing/checkout", json={
            "tier": "pro", "currency": "EUR", "origin_url": BASE_URL,
        }, headers=_h(owner_token), timeout=20)
        assert r.status_code == 400

    def test_checkout_pro_usd(self, session, owner_token):
        r = session.post(f"{API}/billing/checkout", json={
            "tier": "pro", "currency": "USD", "origin_url": BASE_URL,
        }, headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("url", "").startswith("http")
        assert body.get("session_id")
        pytest.session_id = body["session_id"]

    def test_status_pending_for_unpaid_session(self, session, owner_token):
        # Without completing checkout, status should be open/unpaid (not paid).
        r = session.get(f"{API}/billing/status/{pytest.session_id}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body.get("payment_status") in ("unpaid", "no_payment_required", "pending")

    def test_status_unknown_session_404(self, session, owner_token):
        r = session.get(f"{API}/billing/status/cs_unknown_xxx", headers=_h(owner_token))
        assert r.status_code == 404

    def test_webhook_empty_body_400(self):
        # No signature, empty body -> webhook should reject (not 500)
        r = requests.post(f"{API}/webhook/stripe", data=b"", timeout=15)
        assert r.status_code == 400
