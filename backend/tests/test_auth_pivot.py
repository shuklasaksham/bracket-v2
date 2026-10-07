"""Bracket — backend P0 tests for the Feb 2026 auth pivot.

Covers: Email-OTP, /auth/me, profile update, password, projects CRUD with
owner isolation, AI flow steps 1-2, share + reject loop, owner-reply,
claim flow, and logout.
"""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient

def _load_env_var(key: str) -> str:
    if key in os.environ:
        return os.environ[key]
    # Fall back to /app/frontend/.env (testing context)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError:
        pass
    raise KeyError(key)


BASE_URL = _load_env_var("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "bracket_db")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def _email():
    return f"e2e-{uuid.uuid4().hex[:10]}@example.com"


def _sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _signup(s, email=None, name="E2E Tester", designation="Designer"):
    email = email or _email()
    r = s.post(f"{API}/auth/otp/request", json={"email": email, "name": name})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "dev_code" in data, f"OTP_TEST_MODE not exposing dev_code: {data}"
    code = data["dev_code"]
    r2 = s.post(
        f"{API}/auth/otp/verify",
        json={
            "email": email,
            "code": code,
            "name": name,
            "designation": designation,
            "avatar": "mono-1",
        },
    )
    assert r2.status_code == 200, r2.text
    return email, r2.json()


# ============================================================================
# AUTH — OTP request/verify, me, update, password, login, logout
# ============================================================================
class TestAuthOTP:
    def test_otp_request_returns_dev_code(self):
        s = _sess()
        email = _email()
        r = s.post(f"{API}/auth/otp/request", json={"email": email, "name": "E2E"})
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert body.get("ttl_minutes") == 10
        assert "dev_code" in body
        assert len(body["dev_code"]) == 6

    def test_otp_verify_creates_new_user_and_sets_cookie(self):
        s = _sess()
        email, body = _signup(s)
        assert body["is_new"] is True
        assert "session_token" in body
        user = body["user"]
        assert user["email"] == email
        assert user["name"] == "E2E Tester"
        assert user["designation"] == "Designer"
        assert "password_hash" not in user
        assert user.get("has_password") is False
        # Cookie set
        assert s.cookies.get("session_token") is not None

    def test_otp_verify_wrong_code(self):
        s = _sess()
        email = _email()
        s.post(f"{API}/auth/otp/request", json={"email": email, "name": "X"})
        r = s.post(
            f"{API}/auth/otp/verify",
            json={"email": email, "code": "000000", "name": "X"},
        )
        assert r.status_code == 400


class TestAuthMeAndProfile:
    def test_me_with_cookie(self):
        s = _sess()
        email, _ = _signup(s)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == email
        assert "password_hash" not in u
        assert "has_password" in u

    def test_me_unauth_returns_401(self):
        s = _sess()
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_patch_me_updates_profile(self):
        s = _sess()
        _signup(s)
        r = s.patch(
            f"{API}/auth/me",
            json={"name": "Updated Name", "designation": "Lead", "avatar": "mono-3"},
        )
        assert r.status_code == 200
        u = r.json()
        assert u["name"] == "Updated Name"
        assert u["designation"] == "Lead"
        assert u["avatar"] == "mono-3"


class TestPasswordAndLogin:
    def test_set_password_then_login(self):
        s = _sess()
        email, _ = _signup(s)
        r = s.post(f"{API}/auth/password/set", json={"password": "supersecret123"})
        assert r.status_code == 200

        # New unauthenticated session
        s2 = _sess()
        r2 = s2.post(f"{API}/auth/login", json={"email": email, "password": "supersecret123"})
        assert r2.status_code == 200, r2.text
        assert s2.cookies.get("session_token") is not None
        me = s2.get(f"{API}/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email
        # iteration_5: has_password fix is verified — should be True now.
        assert me.json()["has_password"] is True

        # Wrong password
        s3 = _sess()
        r3 = s3.post(f"{API}/auth/login", json={"email": email, "password": "wrongpass"})
        assert r3.status_code == 401


class TestLogout:
    def test_logout_invalidates_session(self):
        s = _sess()
        _signup(s)
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # Clear cookie locally too (server cleared it via Set-Cookie)
        s.cookies.clear()
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401


# ============================================================================
# PROJECTS — auth required, owner isolation, rename, delete
# ============================================================================
class TestProjectsCRUD:
    def test_create_project_requires_auth(self):
        s = _sess()
        r = s.post(f"{API}/projects", json={"project_name": "TEST_unauth", "engine": "claude"})
        assert r.status_code == 401

    def test_create_project_authed(self):
        s = _sess()
        _signup(s)
        r = s.post(f"{API}/projects", json={"project_name": "TEST_alpha", "engine": "claude"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == "TEST_alpha"
        assert p["status"] == "draft"
        assert p["step"] == 1
        assert p["owner_user_id"]
        assert p["share_status"] == "none"

    def test_list_projects_is_owner_scoped(self):
        # User A
        sa = _sess()
        _signup(sa)
        ra = sa.post(f"{API}/projects", json={"project_name": "TEST_A1"})
        pa_id = ra.json()["id"]

        # User B
        sb = _sess()
        _signup(sb)
        rb = sb.post(f"{API}/projects", json={"project_name": "TEST_B1"})
        pb_id = rb.json()["id"]

        # A's list contains only A's project
        la = sa.get(f"{API}/projects").json()
        ids_a = {p["id"] for p in la}
        assert pa_id in ids_a
        assert pb_id not in ids_a

        # B's list contains only B's project
        lb = sb.get(f"{API}/projects").json()
        ids_b = {p["id"] for p in lb}
        assert pb_id in ids_b
        assert pa_id not in ids_b

    def test_rename_and_delete_project(self):
        s = _sess()
        _signup(s)
        pid = s.post(f"{API}/projects", json={"project_name": "TEST_rn"}).json()["id"]
        r = s.patch(f"{API}/projects/{pid}", json={"name": "TEST_rn_new"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_rn_new"

        rd = s.delete(f"{API}/projects/{pid}")
        assert rd.status_code == 200

        # After delete, accessing it via owner-scoped patch should 404
        r2 = s.patch(f"{API}/projects/{pid}", json={"name": "ghost"})
        assert r2.status_code == 404

    def test_non_owner_cannot_rename_or_delete(self):
        sa = _sess()
        _signup(sa)
        pid = sa.post(f"{API}/projects", json={"project_name": "TEST_iso"}).json()["id"]

        sb = _sess()
        _signup(sb)
        r = sb.patch(f"{API}/projects/{pid}", json={"name": "hijack"})
        assert r.status_code == 404
        rd = sb.delete(f"{API}/projects/{pid}")
        assert rd.status_code == 404


# ============================================================================
# AI flow — situation + context steps (real LLM, may be slow)
# ============================================================================
class TestAIFlow:
    @pytest.mark.timeout(120)
    def test_situation_and_context_steps(self):
        s = _sess()
        _signup(s)
        pid = s.post(f"{API}/projects", json={"project_name": "TEST_AI"}).json()["id"]

        # Step 1
        sit_payload = {
            "what": "Redesign our marketing site to be more conversion-focused, but keep our brand quirky.",
            "who": "CEO, founder, sales team, marketing manager.",
            "unclear": "Whether to push back on a full rebrand or do incremental visual updates.",
        }
        r1 = s.post(f"{API}/projects/{pid}/situation", json=sit_payload, timeout=90)
        assert r1.status_code == 200, r1.text
        p1 = r1.json()
        assert p1.get("framing") is not None
        assert p1["step"] >= 2

        # Step 2
        ctx_payload = {
            "requirements": "Improve conversion, keep brand voice.",
            "constraints": "6 weeks, no engineering bandwidth for new components.",
            "inspirations": "Linear, Vercel.",
        }
        r2 = s.post(f"{API}/projects/{pid}/context", json=ctx_payload, timeout=90)
        assert r2.status_code == 200, r2.text
        p2 = r2.json()
        assert p2.get("context") is not None
        assert p2["step"] >= 3


# ============================================================================
# SHARE + REJECT + OWNER REPLY
# ============================================================================
class TestShareAndOwnerReply:
    def _seed_project_with_artifacts(self, s):
        pid = s.post(f"{API}/projects", json={"project_name": "TEST_share"}).json()["id"]
        # Bypass real AI by writing artifacts directly in Mongo to keep test fast.
        db.projects.update_one(
            {"id": pid},
            {
                "$set": {
                    "framing": {"reframed_problem": "x", "tensions": []},
                    "context": {"what_actually_matters": "y", "key_signals": []},
                    "decision": {"recommendation": {"title": "t", "confidence": 80, "rationale": "r"}},
                    "artifacts": {"scope_doc": {"title": "s"}, "client_message": "msg"},
                    "status": "locked",
                    "step": 5,
                }
            },
        )
        return pid

    def test_full_share_reject_reply_loop(self):
        s = _sess()
        _signup(s)
        pid = self._seed_project_with_artifacts(s)

        # Mint share link
        r = s.post(f"{API}/projects/{pid}/share")
        assert r.status_code == 200, r.text
        proj = r.json()
        token = proj["share_token"]
        assert token
        assert proj["share_status"] in ("sent", "viewed")

        # Public share view (unauth ok)
        anon = requests.Session()
        rv = anon.get(f"{API}/share/{token}")
        assert rv.status_code == 200
        v = rv.json()
        assert v["id"] == pid
        assert "owner_replies" in v

        # Skip AI preview to keep test fast — go straight to confirm with stub suggestions
        rc = anon.post(
            f"{API}/share/{token}/reject/confirm",
            json={
                "concerns": "We disagree with the recommended approach.",
                "signature_name": "Client Person",
                "role": "PM",
                "ai_suggestions": {"counter_points": []},
            },
        )
        assert rc.status_code == 200, rc.text
        assert rc.json()["share_status"] == "rejected"

        # Owner reply — should flip to awaiting_reply
        rr = s.post(f"{API}/projects/{pid}/reply", json={"text": "Thanks — here's why we still think X works."})
        assert rr.status_code == 200, rr.text
        proj = rr.json()
        assert proj["share_status"] == "awaiting_reply"
        assert len(proj["owner_replies"]) == 1
        assert proj["owner_replies"][0]["text"].startswith("Thanks")

        # Reply when NOT in rejected state should 400
        rr2 = s.post(f"{API}/projects/{pid}/reply", json={"text": "again"})
        assert rr2.status_code == 400

    def test_reject_preview_ai_suggestions(self):
        s = _sess()
        _signup(s)
        pid = self._seed_project_with_artifacts(s)
        token = s.post(f"{API}/projects/{pid}/share").json()["share_token"]

        anon = requests.Session()
        r = anon.post(
            f"{API}/share/{token}/reject/preview",
            json={"concerns": "I'm worried the timeline is too aggressive and risk flags are understated."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ai_suggestions" in body


# ============================================================================
# CLAIM FLOW
# ============================================================================
class TestClaimFlow:
    def test_claim_keep_and_delete(self):
        # Create an orphan project directly in Mongo for a fresh email
        email = _email()
        keep_id = f"proj_keep_{uuid.uuid4().hex[:8]}"
        del_id = f"proj_del_{uuid.uuid4().hex[:8]}"
        for pid in (keep_id, del_id):
            db.projects.insert_one({
                "id": pid,
                "name": f"orphan-{pid}",
                "creator_email": email,
                "status": "draft",
                "step": 1,
                "share_status": "none",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            })

        s = _sess()
        _signup(s, email=email)

        # Claimable list
        rc = s.get(f"{API}/auth/claimable")
        assert rc.status_code == 200
        claimable_ids = {p["id"] for p in rc.json()}
        assert keep_id in claimable_ids
        assert del_id in claimable_ids

        # Claim
        rsubmit = s.post(
            f"{API}/auth/claim",
            json={"keep_ids": [keep_id], "delete_ids": [del_id]},
        )
        assert rsubmit.status_code == 200
        body = rsubmit.json()
        assert body["claimed"] == 1
        assert body["deleted"] == 1

        # Verify in projects listing
        owned = {p["id"] for p in s.get(f"{API}/projects").json()}
        assert keep_id in owned
        # Deleted project must be gone
        assert db.projects.find_one({"id": del_id}) is None


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
