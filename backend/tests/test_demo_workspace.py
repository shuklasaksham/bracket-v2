"""Backend tests for Bracket Demo Workspace sandbox (/api/demo/*)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env fallback
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

PRO_EMAIL = "pro@use-bracket.com"
FRESH_EMAIL = "fresh@use-bracket.com"


def _otp_login(email):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/request", json={"email": email}, timeout=30)
    assert r.status_code == 200, f"otp/request failed: {r.status_code} {r.text}"
    code = r.json().get("dev_code")
    assert code, f"no dev_code: {r.text}"
    r = s.post(f"{BASE_URL}/api/auth/otp/verify",
               json={"email": email, "code": code}, timeout=30)
    assert r.status_code == 200, f"otp/verify failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def pro_session():
    s = _otp_login(PRO_EMAIL)
    # Reset to clean baseline
    r = s.post(f"{BASE_URL}/api/demo/reset", timeout=60)
    assert r.status_code == 200, f"reset failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def fresh_session():
    return _otp_login(FRESH_EMAIL)


class TestDemoOpenAndSeed:
    def test_open_returns_project_and_state(self, pro_session):
        # After the module-scope reset, call open and verify shape.
        r = pro_session.post(f"{BASE_URL}/api/demo/open", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "project_id" in data and data["project_id"]
        assert "demo_state" in data
        state = data["demo_state"]
        assert state.get("sim_step") == 0
        assert state.get("sim_total") == 5
        pytest.demo_pid = data["project_id"]

    def test_open_idempotent_same_project(self, pro_session):
        r1 = pro_session.post(f"{BASE_URL}/api/demo/open", timeout=60)
        pid1 = r1.json()["project_id"]
        r2 = pro_session.post(f"{BASE_URL}/api/demo/open", timeout=60)
        pid2 = r2.json()["project_id"]
        assert pid1 == pid2, "Second /open created a duplicate project"

    def test_baseline_memory_has_13_items(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        total = data.get("total")
        counts = data.get("counts") or {}
        assert 12 <= total <= 15, f"Baseline total unexpected: {total} ({counts})"
        for c in ["scope", "decision", "deadline", "deliverable", "requirement", "question"]:
            assert counts.get(c, 0) >= 1, f"Missing category {c}: counts={counts}"

    def test_ask_grounded_baseline(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.post(f"{BASE_URL}/api/projects/{pid}/ask",
                             json={"question": "What is the current launch date and payment provider?"},
                             timeout=120)
        assert r.status_code == 200, r.text
        txt = (r.json().get("answer") or r.json().get("reply") or str(r.json())).lower()
        assert "october 20" in txt or "oct 20" in txt, f"Missing Oct 20: {txt[:300]}"
        assert "stripe" in txt, f"Missing Stripe: {txt[:300]}"


class TestSimulationBeats:
    def test_run_all_five_beats(self, pro_session):
        pid = pytest.demo_pid
        beats = []
        for i in range(5):
            r = pro_session.post(f"{BASE_URL}/api/demo/simulate/next", timeout=120)
            assert r.status_code == 200, f"beat {i}: {r.text}"
            data = r.json()
            assert data.get("step") == i + 1
            assert data.get("total") == 5
            beats.append(data)
        # Final beat says done
        assert beats[-1].get("done") is True
        # Beat 3 (figma, index 2) is conflict
        assert beats[2]["beat"]["is_conflict"] is True
        assert beats[2]["beat"]["key"] == "figma_conflict"
        pytest.beats = beats

    def test_scope_change_notification_created(self, pro_session):
        # Beat 2 (slack) should have created a notification
        r = pro_session.get(f"{BASE_URL}/api/notifications", timeout=30)
        assert r.status_code == 200, r.text
        notifs = r.json()
        if isinstance(notifs, dict):
            notifs = notifs.get("items") or notifs.get("notifications") or []
        scope_notifs = [n for n in notifs if n.get("project_id") == pytest.demo_pid
                        and (n.get("type") in ("scope_creep", "scope_change")
                             or "scope" in (n.get("type") or "").lower())]
        assert len(scope_notifs) >= 1, f"No scope-change notification. Got: {notifs[:3]}"

    def test_conflict_memory_item_exists(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=30)
        data = r.json()
        all_items = []
        for v in (data.get("grouped") or {}).values():
            all_items.extend(v)
        conflicts = [i for i in all_items if i.get("is_conflict")]
        assert len(conflicts) >= 1, "No is_conflict memory item"
        c = conflicts[0]
        cv = c.get("conflict_values") or []
        vals = {v.get("value") for v in cv}
        assert "October 27" in vals and "October 20" in vals, f"conflict_values={cv}"

    def test_memory_grew_after_beats(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=30)
        data = r.json()
        total = data.get("total") or 0
        # 13 baseline + beats added several more (6 memory docs from beats)
        assert total >= 17, f"Memory did not grow: {total}"


class TestReplyDraftAndSend:
    def test_suggest_reply(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.post(
            f"{BASE_URL}/api/projects/{pid}/suggest-reply",
            json={"instruction": "Draft a clarification email to Sarah asking her to confirm Oct 27 vs the Oct 20 design handoff."},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        reply = r.json().get("reply") or r.json().get("draft") or r.json().get("body") or ""
        assert isinstance(reply, str) and len(reply.strip()) > 20, f"Empty reply: {r.json()}"

    def test_send_demo_email(self, pro_session):
        r = pro_session.post(f"{BASE_URL}/api/demo/send-email",
                             json={"subject": "x", "body": "y"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "no real email" in (data.get("message") or "").lower()


class TestClientReplyResolution:
    def test_client_reply_resolves_conflict(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.post(f"{BASE_URL}/api/demo/client-reply", timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # memory should no longer have is_conflict
        m = pro_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=30).json()
        all_items = []
        for v in (m.get("grouped") or {}).values():
            all_items.extend(v)
        conflicts = [i for i in all_items if i.get("is_conflict")]
        assert len(conflicts) == 0, f"Still has conflicts: {conflicts}"

    def test_ask_after_resolution(self, pro_session):
        pid = pytest.demo_pid
        r = pro_session.post(f"{BASE_URL}/api/projects/{pid}/ask",
                             json={"question": "What is the confirmed launch date now?"},
                             timeout=120)
        assert r.status_code == 200, r.text
        txt = (r.json().get("answer") or r.json().get("reply") or str(r.json())).lower()
        assert "october 27" in txt or "oct 27" in txt, f"Missing Oct 27: {txt[:300]}"


class TestResetAndQuota:
    def test_reset_wipes_and_reseeds(self, pro_session):
        r = pro_session.post(f"{BASE_URL}/api/demo/reset", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("project_id")
        state = data.get("demo_state") or {}
        assert state.get("sim_step") == 0
        pid = data["project_id"]
        m = pro_session.get(f"{BASE_URL}/api/projects/{pid}/memory", timeout=30).json()
        all_items = []
        for v in (m.get("grouped") or {}).values():
            all_items.extend(v)
        assert not any(i.get("is_conflict") for i in all_items), "Reset did not clear conflicts"

    def test_quota_excludes_demo(self, pro_session):
        # Verify demo project exists but is not counted in quota.used
        p_resp = pro_session.get(f"{BASE_URL}/api/projects", timeout=30).json()
        projects = p_resp if isinstance(p_resp, list) else (p_resp.get("items") or p_resp.get("projects") or [])
        demo_projects = [p for p in projects if p.get("is_demo")]
        non_demo = [p for p in projects if not p.get("is_demo") and not p.get("archived")]
        assert len(demo_projects) >= 1, "Demo project should be visible in /api/projects"
        r = pro_session.get(f"{BASE_URL}/api/project-quota", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        used = data.get("used")
        assert used == len(non_demo), (
            f"Expected used={len(non_demo)} (non-demo only), got used={used}; "
            f"demo_count={len(demo_projects)} data={data}"
        )


class TestPaywallBypass:
    def test_fresh_user_can_open_demo(self, fresh_session):
        """No-plan user should still be able to open demo workspace."""
        r = fresh_session.post(f"{BASE_URL}/api/demo/open", timeout=60)
        assert r.status_code == 200, f"Fresh user demo open failed: {r.text}"
        pid = r.json().get("project_id")
        assert pid
        # cleanup
        fresh_session.post(f"{BASE_URL}/api/demo/reset", timeout=60)
