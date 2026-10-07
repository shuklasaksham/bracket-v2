"""One-off: wipe all user-generated data and seed 3 demo accounts.

- fresh@use-bracket.com  : no plan, no projects
- solo@use-bracket.com   : $9 "project" plan, 1 project
- pro@use-bracket.com    : $29 "monthly" plan, 2 projects

Projects are built through the REAL connect+AI pipeline (demo Gmail sources),
so each project has genuinely extracted memory. Payments are set directly
(test env). Run:  python3 /app/scripts/seed_demo.py
"""
import asyncio
import os
import secrets
from datetime import datetime, timezone, timedelta

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.hash import bcrypt
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
API = "http://localhost:8001/api"
PASSWORD = "Bracket@2026"

KEEP = {"admin_config", "counters", "geoip_cache"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def gen_user_id():
    return f"user_{secrets.token_hex(6)}"


def gen_session_token():
    return f"st_{secrets.token_urlsafe(28)}"


async def wipe(db):
    names = await db.list_collection_names()
    for coll in names:
        if coll in KEEP:
            continue
        res = await db[coll].delete_many({})
        print(f"  wiped {coll}: {res.deleted_count}")


async def make_user(db, email, name, designation, plan=None):
    uid = gen_user_id()
    ts = now_iso()
    doc = {
        "user_id": uid,
        "email": email.lower(),
        "name": name,
        "designation": designation,
        "avatar": "mono-1",
        "picture": "",
        "password_hash": bcrypt.hash(PASSWORD),
        "created_at": ts,
        "updated_at": ts,
        "has_completed_first_flow": bool(plan),
    }
    if plan:
        doc["plan"] = plan
        doc["plan_kind"] = "subscription" if plan == "monthly" else "payment"
        doc["plan_since"] = ts
    await db.users.insert_one(doc)
    token = gen_session_token()
    await db.user_sessions.insert_one({
        "user_id": uid,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "created_at": ts,
    })
    print(f"  created {email} (plan={plan}) uid={uid}")
    return uid, token


async def build_project(token, source_ids):
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=150) as client:
        r = await client.get(f"{API}/connect/gmail/sources", headers=headers)
        r.raise_for_status()
        all_src = {s["id"]: s for s in r.json()["sources"]}
        chosen = [{"id": sid, "name": all_src[sid]["name"], "url": all_src[sid].get("url", "")}
                  for sid in source_ids if sid in all_src]
        pv = await client.post(f"{API}/connect/preview", headers=headers,
                               json={"provider": "gmail", "sources": chosen})
        pv.raise_for_status()
        preview_id = pv.json()["preview_id"]
        proj_name = (pv.json().get("project") or {}).get("name", "")
        est = await client.post(f"{API}/connect/establish", headers=headers,
                                json={"preview_id": preview_id, "mode": "new"})
        est.raise_for_status()
        data = est.json()
        print(f"    -> project '{proj_name}' id={data['project_id']} memory={data['memory_count']}")
        return data["project_id"]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print("== WIPE ==")
    await wipe(db)

    print("== USERS ==")
    await make_user(db, "fresh@use-bracket.com", "Fresh Start", "Product Designer", plan=None)
    solo_uid, solo_tok = await make_user(db, "solo@use-bracket.com", "Sam Rivera", "Freelance Designer", plan="project")
    pro_uid, pro_tok = await make_user(db, "pro@use-bracket.com", "Priya Anand", "Design Lead", plan="monthly")

    print("== PROJECTS (solo, $9, 1) ==")
    await build_project(solo_tok, ["demo-gmail-1", "demo-gmail-5"])

    print("== PROJECTS (pro, $29, 2) ==")
    await build_project(pro_tok, ["demo-gmail-2"])
    await build_project(pro_tok, ["demo-gmail-3", "demo-gmail-4"])

    print("== VERIFY ==")
    for email in ("fresh@use-bracket.com", "solo@use-bracket.com", "pro@use-bracket.com"):
        u = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "plan": 1})
        n = await db.projects.count_documents({"owner_user_id": u["user_id"]})
        print(f"  {email}: plan={u.get('plan')} projects={n}")
    print("DONE")


if __name__ == "__main__":
    asyncio.run(main())
