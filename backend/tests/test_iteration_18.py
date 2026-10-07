"""Iteration 18 — 3 bug fixes: orphan project claim + sidebar CSS + AI quality."""
import os, time, uuid, pytest, requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
MONGO = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB = os.environ.get("DB_NAME", "bracket_db")


def _otp_login(email, name="E2E"):
    s = requests.Session()
    r = s.post(f"{API}/auth/otp/request", json={"email": email, "name": name}, timeout=10)
    assert r.status_code == 200, r.text
    code = r.json().get("dev_code")
    assert code, "OTP_TEST_MODE not enabling dev_code"
    r = s.post(f"{API}/auth/otp/verify", json={"email": email, "code": code, "name": name}, timeout=10)
    assert r.status_code == 200, r.text
    return s, r.json()["user"]


@pytest.fixture(scope="module")
def mongo():
    client = AsyncIOMotorClient(MONGO)
    return client[DB]


# --- BUG FIX 1: orphan project claim ------------------------------------------
class TestOrphanClaim:
    def test_orphan_project_appears_in_list_and_claimed(self, mongo):
        email = f"e2e+orphan{uuid.uuid4().hex[:6]}@example.com"
        pid = uuid.uuid4().hex
        # Insert orphan project directly
        async def _insert():
            await mongo.projects.insert_one({
                "id": pid, "name": "Orphan Project",
                "creator_email": email, "creator_name": "Orphan",
                "engine": "claude", "status": "draft", "step": 1,
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            })
        asyncio.get_event_loop().run_until_complete(_insert())

        s, _ = _otp_login(email)
        r = s.get(f"{API}/projects", timeout=10)
        assert r.status_code == 200, r.text
        ids = [p["id"] for p in r.json()]
        assert pid in ids, f"orphan {pid} not in {ids}"

        # verify owner_user_id was backfilled
        async def _check():
            return await mongo.projects.find_one({"id": pid}, {"_id": 0, "owner_user_id": 1})
        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc.get("owner_user_id"), "owner_user_id not backfilled"

        # cleanup
        s.delete(f"{API}/projects/{pid}", timeout=10)

    def test_orphan_project_get_by_id_and_rename(self, mongo):
        email = f"e2e+orph2{uuid.uuid4().hex[:6]}@example.com"
        pid = uuid.uuid4().hex
        async def _insert():
            await mongo.projects.insert_one({
                "id": pid, "name": "Legacy P",
                "creator_email": email.upper(),  # test case-insensitive
                "engine": "claude", "status": "draft", "step": 1,
                "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
            })
        asyncio.get_event_loop().run_until_complete(_insert())
        s, _ = _otp_login(email)
        # rename must work
        r = s.patch(f"{API}/projects/{pid}", json={"name": "Renamed"}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Renamed"
        # get by id
        r = s.get(f"{API}/projects/{pid}", timeout=10)
        assert r.status_code == 200, r.text
        s.delete(f"{API}/projects/{pid}", timeout=10)


# --- BUG FIX 3: AI quality (Claude Sonnet 4.5) --------------------------------
class TestAIQuality:
    def test_suggest_returns_3_4_short_strings_fast(self):
        # warmup
        requests.post(f"{API}/suggest", json={"step":1,"field":"what","partial":"w","context":{}}, timeout=15)
        t0 = time.time()
        r = requests.post(f"{API}/suggest", json={
            "step": 1, "field": "what",
            "partial": "redesign the pricing page",
            "context": {}
        }, timeout=15)
        dt = (time.time() - t0) * 1000
        assert r.status_code == 200, r.text
        sugs = r.json().get("suggestions", [])
        assert 1 <= len(sugs) <= 4, f"len={len(sugs)} sugs={sugs}"
        for s in sugs:
            assert 0 < len(s) <= 80
        print(f"suggest latency: {dt:.0f}ms, {len(sugs)} suggestions")
        assert dt <= 5000, f"suggest too slow: {dt:.0f}ms"

    def test_framing_returns_valid_json_from_sonnet(self):
        email = f"e2e+ai{uuid.uuid4().hex[:6]}@example.com"
        s, _ = _otp_login(email)
        r = s.post(f"{API}/projects", json={"project_name": "AI Quality Probe"}, timeout=10)
        pid = r.json()["id"]
        t0 = time.time()
        r = s.post(f"{API}/projects/{pid}/situation", json={
            "what": "Rebrand a boutique yoga studio's identity.",
            "who": "Solo yoga instructor with 40 regulars in Bengaluru.",
            "unclear": "Not sure if we should keep the old logo mark.",
        }, timeout=45)
        dt = (time.time() - t0) * 1000
        assert r.status_code == 200, r.text[:400]
        framing = r.json().get("framing", {})
        assert framing.get("reframed_problem"), f"no reframed_problem: {framing}"
        assert isinstance(framing.get("clarity_score"), (int, float))
        assert isinstance(framing.get("tensions"), list) and len(framing["tensions"]) >= 1
        print(f"framing latency: {dt:.0f}ms, clarity={framing.get('clarity_score')}, tensions={len(framing['tensions'])}")
        s.delete(f"{API}/projects/{pid}", timeout=10)


# --- ADMIN regression ---------------------------------------------------------
class TestAdmin:
    def test_admin_login_and_list_users(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={
            "email": "support@use-bracket.com",
            "password": "Bracket@123",
        }, timeout=10)
        assert r.status_code == 200, r.text
        r = s.get(f"{API}/admin/users", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and isinstance(data["users"], list)
        assert data.get("admin_email") == "support@use-bracket.com"


# --- Regression: guest can still run steps ------------------------------------
class TestGuestRegression:
    def test_guest_creates_project_and_runs_step1(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/guest", timeout=10)
        assert r.status_code == 200
        r = s.post(f"{API}/projects", json={"project_name": "Guest Probe"}, timeout=10)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        r = s.post(f"{API}/projects/{pid}/situation", json={
            "what": "Design a portfolio site.",
            "who": "Illustrator switching from Behance.",
            "unclear": "Voice/tone.",
        }, timeout=45)
        assert r.status_code == 200, r.text[:400]
        assert r.json().get("framing", {}).get("reframed_problem")
        s.delete(f"{API}/projects/{pid}", timeout=10)
