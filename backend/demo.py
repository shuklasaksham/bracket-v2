"""Bracket Demo Workspace (sandbox).

A pre-populated, fully-interactive demo project — "Harbor — Payments App
Launch" — that lets a signed-in user experience Bracket's full loop (project
memory, change detection, a sourced conflict, Ask Bracket, reply drafting and a
simulated email round-trip) using fictional data, before connecting anything
real.

The project is a REAL project document (owned by the user, flagged is_demo) so
it reuses every existing workspace surface, the Ask endpoint and the
suggest-reply endpoint untouched. Simulation beats run authored content through
the real change-detection engine with a curated expected-outcome safety net so
the staged beats always land.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from auth import current_user
from connect_ai import detect_source_updates, extract_from_notes
from connectors import db

logger = logging.getLogger("bracket")

router = APIRouter(prefix="/api/demo")

DEMO_TAG = "demo:harbor_payments_launch"
PROJECT_NAME = "Harbor — Payments App Launch"
CLIENT_NAME = "Harbor"


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# --- Seed definitions ------------------------------------------------------
# Five demo sources. Each becomes a source_connection (is_demo) so it renders
# in the sidebar exactly like a real source.
SOURCES = [
    {"provider": "gmail", "name": "Harbor ⇄ Studio — Launch thread"},
    {"provider": "slack", "name": "#harbor-build (internal)"},
    {"provider": "figma", "name": "Harbor App — Product UI"},
    {"provider": "github", "name": "harbor/payments-app"},
    {"provider": "meeting", "name": "Weekly sync — meeting notes"},
]


def _baseline_memory(pid: str, conns: dict, base: datetime) -> list:
    """A lived-in baseline so Ask Bracket is useful the instant the demo opens."""
    def doc(provider, cat, title, detail, status, by, days_ago):
        ts = _iso(base - timedelta(days=days_ago))
        return {
            "id": _uuid(), "project_id": pid, "connection_id": conns.get(provider, ""),
            "provider": provider, "source_label": next((s["name"] for s in SOURCES if s["provider"] == provider), provider),
            "category": cat, "title": title, "detail": detail, "status": status,
            "requested_by": by, "occurred_at": ts, "created_at": ts, "updated_at": ts,
            "history": [], "is_demo": True,
        }
    return [
        # Scope (confirmed)
        doc("gmail", "scope", "Marketing website", "Public marketing site for the Harbor payments app.", "confirmed", "Sarah Chen", 24),
        doc("gmail", "scope", "Customer dashboard", "Logged-in dashboard where customers manage payments.", "confirmed", "Sarah Chen", 24),
        doc("slack", "scope", "Authentication", "Email + SSO sign-in for Harbor customers.", "confirmed", "Mike", 22),
        doc("gmail", "scope", "Payments", "Accept and manage card payments in-app.", "confirmed", "Sarah Chen", 24),
        # Decision (confirmed)
        doc("slack", "decision", "Stripe for payments", "Team chose Stripe over Adyen for the V1 payments integration.", "confirmed", "Mike", 20),
        # Deadline (confirmed) — this is the value the simulation will later move.
        doc("gmail", "deadline", "Launch — October 20", "Agreed go-live date for the Harbor payments app.", "confirmed", "Sarah Chen", 18),
        # Deliverables
        doc("figma", "deliverable", "Design system", "Shared component library for the app + marketing site.", "confirmed", "Alex", 19),
        doc("figma", "deliverable", "Onboarding flow", "First-run onboarding screens for new Harbor customers.", "confirmed", "Alex", 16),
        doc("github", "deliverable", "Payments integration", "Stripe payments wired into the customer dashboard.", "detected", "Mike", 10),
        # Requirements
        doc("gmail", "requirement", "PCI-compliant checkout", "Checkout must meet Harbor's PCI compliance requirements.", "confirmed", "Sarah Chen", 17),
        doc("meeting", "requirement", "Mobile-responsive dashboard", "Dashboard must work well on mobile for Harbor's users.", "detected", "Sarah Chen", 12),
        # Open questions
        doc("gmail", "question", "Refund policy rules?", "How should partial refunds and disputes be handled at launch?", "detected", "Alex", 9),
        doc("slack", "question", "Analytics in V1 or V2?", "Open question on whether usage analytics ships for launch.", "detected", "Mike", 8),
    ]


def _baseline_events(pid: str, conns: dict, base: datetime) -> list:
    def ev(provider, etype, summary, days_ago):
        ts = _iso(base - timedelta(days=days_ago))
        return {
            "id": _uuid(), "project_id": pid, "connection_id": conns.get(provider, ""),
            "provider": provider, "source_label": next((s["name"] for s in SOURCES if s["provider"] == provider), provider),
            "event_type": etype, "summary": summary, "occurred_at": ts, "created_at": ts, "is_demo": True,
        }
    return [
        ev("gmail", "SOURCE_CONNECTED", "Kickoff: Harbor engaged the studio to design and build their payments app.", 25),
        ev("gmail", "DECISION_DETECTED", "Scope agreed — marketing site, dashboard, auth and payments.", 24),
        ev("slack", "DECISION_DETECTED", "Team selected Stripe for payments over Adyen.", 20),
        ev("gmail", "DEADLINE_CHANGED", "Launch date set to October 20.", 18),
        ev("figma", "ACTIVITY", "Design system and onboarding flow drafted in Figma.", 16),
        ev("github", "ACTIVITY", "Repo scaffolded — auth and payments modules underway.", 11),
        ev("meeting", "REQUIREMENT_DETECTED", "Weekly sync: dashboard must be mobile-responsive.", 12),
    ]


# Simulation beats. Each runs authored content through the real engine (events)
# and lands a curated, guaranteed memory outcome (new_items).
BEATS = [
    {
        "key": "gmail_deadline",
        "provider": "gmail", "mode": "detect",
        "raw": "--- From: Sarah Chen <sarah@harbor.io> (today): Hi — after reviewing with our stakeholders we need to move the launch from October 20 to October 27 so it fits a stakeholder review. Can you confirm the new date works on your side?",
        "summary": "Sarah asked to move the launch from Oct 20 to Oct 27.",
        "event_type": "DEADLINE_CHANGED",
        "memory": [{
            "category": "deadline", "title": "Launch moved to Oct 27",
            "detail": "Sarah asked to move the launch from October 20 to October 27 for a stakeholder review.",
            "status": "detected", "requested_by": "Sarah Chen",
        }],
        "notify": False,
    },
    {
        "key": "slack_scope",
        "provider": "slack", "mode": "detect",
        "raw": "- Mike (today): Team — we should include basic analytics (event tracking + a usage dashboard) in V1 so Harbor can see adoption at launch.\n- Alex (today): Agreed, let's get analytics into V1.",
        "summary": "Team wants analytics (event tracking + usage dashboard) in V1.",
        "event_type": "SCOPE_CHANGE_DETECTED",
        "memory": [{
            "category": "scope_change", "title": "Analytics added to V1",
            "detail": "Team wants event tracking + a usage dashboard in the V1 launch scope.",
            "status": "detected", "requested_by": "Mike",
        }],
        "notify": True,
    },
    {
        "key": "figma_conflict",
        "provider": "figma", "mode": "curated",
        "raw": "- Sarah Chen (today): This onboarding screen looks ready for the October 20 launch 🎉",
        "summary": "Figma comment still references the October 20 launch — conflicts with Oct 27.",
        "event_type": "ACTIVITY",
        "memory": [{
            "category": "deadline", "title": "Launch date conflict",
            "detail": "Gmail says October 27, but a Figma comment still references the October 20 launch.",
            "status": "detected", "requested_by": "Sarah Chen",
            "is_conflict": True, "demo_action": "conflict",
            "conflict_values": [
                {"value": "October 27", "source": "Gmail — Sarah Chen"},
                {"value": "October 20", "source": "Figma comment"},
            ],
        }],
        "notify": False,
    },
    {
        "key": "meeting_notes",
        "provider": "meeting", "mode": "notes",
        "raw": "Weekly sync notes:\n- Discussed Sarah's request to delay launch from Oct 20 to Oct 27. Team agreed Oct 27 works.\n- Agreed to add analytics (event tracking + usage dashboard) to the V1 scope.\n- Mike to scope the analytics work and open a PR.",
        "summary": "Meeting confirmed the Oct 27 delay and the analytics addition.",
        "event_type": "DECISION_DETECTED",
        "memory": [
            {"category": "requirement", "title": "Analytics dashboard required",
             "detail": "Meeting confirmed analytics (event tracking + usage dashboard) is required for V1.",
             "status": "detected", "requested_by": "Mike"},
            {"category": "decision", "title": "Oct 27 delay agreed",
             "detail": "Team agreed in the weekly sync to move the launch to October 27.",
             "status": "detected", "requested_by": "Mike"},
        ],
        "notify": False,
    },
    {
        "key": "github_scope",
        "provider": "github", "mode": "detect",
        "raw": "- mike-dev opened PR #142 (today): Add analytics event tracking + usage dashboard (branch feat/analytics-v1). Implements the analytics scope agreed for V1.",
        "summary": "PR #142 implements the new analytics scope.",
        "event_type": "DELIVERABLE_STATUS_DETECTED",
        "memory": [{
            "category": "deliverable", "title": "Analytics implementation",
            "detail": "PR #142 adds analytics event tracking + a usage dashboard, reinforcing the new scope.",
            "status": "detected", "requested_by": "Mike",
        }],
        "notify": False,
    },
]


async def _get_demo_project(uid: str):
    return await db.projects.find_one({"owner_user_id": uid, "demo_tag": DEMO_TAG}, {"_id": 0})


async def _seed(uid: str, user: dict) -> dict:
    """Create the demo project + sources + baseline memory/events. Idempotent-ish
    (callers delete first on reset)."""
    now = _now()
    pid = _uuid()
    conns = {}
    conn_docs = []
    for s in SOURCES:
        cid = _uuid()
        conns[s["provider"]] = cid
        conn_docs.append({
            "id": cid, "project_id": pid, "user_id": uid,
            "provider": s["provider"], "source_type": s["provider"],
            "source_id": f"demo-{s['provider']}", "source_name": s["name"], "source_url": "",
            "status": "connected", "is_demo": True,
            "content_hash": "", "content_cache": "",
            "last_synced_at": _iso(now), "last_activity_at": _iso(now),
            "created_at": _iso(now), "updated_at": _iso(now),
        })
    await db.projects.insert_one({
        "id": pid, "name": PROJECT_NAME, "name_source": "demo",
        "creator_name": user.get("name", ""), "creator_email": user.get("email", ""),
        "owner_user_id": uid, "engine": "claude", "status": "in_progress", "step": 1,
        "client_name": CLIENT_NAME,
        "description": "A product studio is designing and building a new payments app for fintech client Harbor.",
        "is_demo": True, "demo_tag": DEMO_TAG,
        "demo_state": {"sim_step": 0, "sim_total": len(BEATS), "email_sent": False,
                       "reply_received": False, "conflict_resolved": False},
        "archived": False, "created_at": _iso(now), "updated_at": _iso(now),
    })
    await db.source_connections.insert_many(conn_docs)
    mem = _baseline_memory(pid, conns, now)
    if mem:
        await db.project_memory.insert_many(mem)
    evs = _baseline_events(pid, conns, now)
    if evs:
        await db.source_events.insert_many(evs)
    return await _get_demo_project(uid)


async def _purge(uid: str, pid: str):
    await db.project_memory.delete_many({"project_id": pid})
    await db.source_connections.delete_many({"project_id": pid})
    await db.source_events.delete_many({"project_id": pid})
    await db.notifications.delete_many({"project_id": pid})
    await db.projects.delete_one({"id": pid, "owner_user_id": uid})


# --- Endpoints -------------------------------------------------------------
@router.post("/open")
async def demo_open(request: Request):
    """Return the user's demo project, seeding it on first open. Idempotent."""
    user = await current_user(request, db)
    uid = user["user_id"]
    proj = await _get_demo_project(uid)
    if not proj:
        proj = await _seed(uid, user)
    await _track(uid, "demo_workspace_opened", proj["id"])
    return {"project_id": proj["id"], "demo_state": proj.get("demo_state", {})}


@router.get("/project")
async def demo_project(request: Request):
    user = await current_user(request, db)
    proj = await _get_demo_project(user["user_id"])
    return {"project_id": proj["id"] if proj else None,
            "demo_state": proj.get("demo_state", {}) if proj else None}


@router.post("/reset")
async def demo_reset(request: Request):
    user = await current_user(request, db)
    uid = user["user_id"]
    proj = await _get_demo_project(uid)
    if proj:
        await _purge(uid, proj["id"])
    fresh = await _seed(uid, user)
    await _track(uid, "demo_reset", fresh["id"])
    return {"project_id": fresh["id"], "demo_state": fresh.get("demo_state", {})}


class SimIn(BaseModel):
    pass


@router.post("/simulate/next")
async def demo_simulate_next(request: Request):
    """Release the next predetermined beat through the real pipeline (+ curated
    safety net). Returns the beat that just landed and whether more remain."""
    user = await current_user(request, db)
    uid = user["user_id"]
    proj = await _get_demo_project(uid)
    if not proj:
        raise HTTPException(404, "No demo workspace — open one first.")
    state = proj.get("demo_state") or {}
    step = int(state.get("sim_step") or 0)
    if step >= len(BEATS):
        return {"done": True, "step": step, "total": len(BEATS)}

    beat = BEATS[step]
    pid = proj["id"]
    conn = await db.source_connections.find_one(
        {"project_id": pid, "provider": beat["provider"]}, {"_id": 0, "id": 1, "source_name": 1})
    conn_id = conn["id"] if conn else ""
    source_label = conn["source_name"] if conn else beat["provider"]
    now = _now()

    # Run the REAL engine so the beat genuinely flows through extraction /
    # change-detection; fall back to the curated summary if the model is quiet.
    ai_summary = None
    try:
        titles = [m["title"] async for m in db.project_memory.find(
            {"project_id": pid, "status": {"$ne": "ignored"}}, {"_id": 0, "title": 1}).limit(60)]
        if beat["mode"] == "notes":
            res = await extract_from_notes(PROJECT_NAME, titles, beat["raw"])
        elif beat["mode"] == "detect":
            res = await detect_source_updates(beat["provider"], source_label, PROJECT_NAME, titles, beat["raw"])
        else:
            res = {}
        evs = (res or {}).get("events") or []
        if evs and isinstance(evs[0], dict) and evs[0].get("summary"):
            ai_summary = str(evs[0]["summary"])[:300]
    except Exception as e:
        logger.warning("demo beat %s engine call failed: %s", beat["key"], e)

    # Curated memory docs — the guaranteed outcome of this beat.
    mem_docs = []
    for m in beat["memory"]:
        mem_docs.append({
            "id": _uuid(), "project_id": pid, "connection_id": conn_id,
            "provider": beat["provider"], "source_label": source_label,
            "category": m["category"], "title": m["title"], "detail": m["detail"],
            "status": m.get("status", "detected"), "requested_by": m.get("requested_by", ""),
            "occurred_at": _iso(now), "created_at": _iso(now), "updated_at": _iso(now),
            "history": [], "is_demo": True, "demo_beat": beat["key"],
            **({"is_conflict": True} if m.get("is_conflict") else {}),
            **({"demo_action": m["demo_action"]} if m.get("demo_action") else {}),
            **({"conflict_values": m["conflict_values"]} if m.get("conflict_values") else {}),
        })
    if mem_docs:
        await db.project_memory.insert_many(mem_docs)

    await db.source_events.insert_one({
        "id": _uuid(), "project_id": pid, "connection_id": conn_id,
        "provider": beat["provider"], "source_label": source_label,
        "event_type": beat["event_type"], "summary": ai_summary or beat["summary"],
        "occurred_at": _iso(now), "created_at": _iso(now), "is_demo": True,
    })

    if beat.get("notify"):
        scope_doc = next((d for d in mem_docs if d["category"] == "scope_change"), None)
        if scope_doc:
            await db.notifications.insert_one({
                "id": _uuid(), "user_id": uid, "project_id": pid, "project_name": PROJECT_NAME,
                "connection_id": conn_id, "provider": beat["provider"], "source_label": source_label,
                "memory_id": scope_doc["id"], "type": "scope_creep",
                "title": scope_doc["title"], "detail": scope_doc["detail"],
                "read": False, "digested": True, "created_at": _iso(now), "is_demo": True,
            })

    new_step = step + 1
    state["sim_step"] = new_step
    await db.projects.update_one({"id": pid}, {"$set": {"demo_state": state, "updated_at": _iso(now)}})

    if step == 0:
        await _track(uid, "demo_simulation_started", pid)
    if beat["key"] == "figma_conflict":
        await _track(uid, "demo_conflict_viewed", pid)
    await _track(uid, "demo_change_detected_viewed", pid)
    done = new_step >= len(BEATS)
    if done:
        await _track(uid, "demo_simulation_completed", pid)

    return {
        "done": done, "step": new_step, "total": len(BEATS),
        "beat": {"key": beat["key"], "provider": beat["provider"], "source_label": source_label,
                 "summary": ai_summary or beat["summary"], "event_type": beat["event_type"],
                 "is_conflict": beat["key"] == "figma_conflict"},
    }


class SendEmailIn(BaseModel):
    body: str = ""
    subject: str = ""


@router.post("/send-email")
async def demo_send_email(payload: SendEmailIn, request: Request):
    """Demo-mode 'send' — no real email leaves Bracket. Records the outgoing
    message to the demo timeline and arms the simulated client reply."""
    user = await current_user(request, db)
    uid = user["user_id"]
    proj = await _get_demo_project(uid)
    if not proj:
        raise HTTPException(404, "No demo workspace.")
    pid = proj["id"]
    now = _now()
    conn = await db.source_connections.find_one({"project_id": pid, "provider": "gmail"}, {"_id": 0, "id": 1, "source_name": 1})
    await db.source_events.insert_one({
        "id": _uuid(), "project_id": pid, "connection_id": conn["id"] if conn else "",
        "provider": "gmail", "source_label": conn["source_name"] if conn else "Gmail",
        "event_type": "ACTIVITY",
        "summary": "You sent a clarification email to Sarah asking her to confirm Oct 27 vs the Oct 20 design handoff. (Demo — no real email sent.)",
        "occurred_at": _iso(now), "created_at": _iso(now), "is_demo": True,
    })
    state = proj.get("demo_state") or {}
    state["email_sent"] = True
    await db.projects.update_one({"id": pid}, {"$set": {"demo_state": state, "updated_at": _iso(now)}})
    await _track(uid, "demo_email_sent", pid)
    return {"ok": True, "message": "Demo email sent — no real email was delivered. Sarah will reply in a moment."}


@router.post("/client-reply")
async def demo_client_reply(request: Request):
    """Simulated client response from Sarah that resolves the launch-date
    conflict and confirms October 27 as the launch date."""
    user = await current_user(request, db)
    uid = user["user_id"]
    proj = await _get_demo_project(uid)
    if not proj:
        raise HTTPException(404, "No demo workspace.")
    pid = proj["id"]
    now = _now()
    conn = await db.source_connections.find_one({"project_id": pid, "provider": "gmail"}, {"_id": 0, "id": 1, "source_name": 1})
    label = conn["source_name"] if conn else "Gmail"
    cid = conn["id"] if conn else ""

    # Sarah's inbound reply on the demo timeline.
    await db.source_events.insert_one({
        "id": _uuid(), "project_id": pid, "connection_id": cid, "provider": "gmail", "source_label": label,
        "event_type": "DECISION_DETECTED",
        "summary": "Sarah replied: \"Yes, October 27 is confirmed. Please disregard the old October 20 date.\"",
        "occurred_at": _iso(now), "created_at": _iso(now), "is_demo": True,
    })

    # Resolve the conflict item.
    await db.project_memory.update_many(
        {"project_id": pid, "is_conflict": True},
        {"$set": {
            "title": "Launch confirmed: October 27", "status": "confirmed",
            "detail": "Sarah confirmed October 27 and retired the October 20 date — conflict resolved.",
            "is_conflict": False, "conflict_resolved": True, "updated_at": _iso(now),
        }, "$unset": {"demo_action": "", "conflict_values": ""}},
    )
    # Confirm the deadline change + retire the old Oct 20 baseline date.
    await db.project_memory.update_many(
        {"project_id": pid, "demo_beat": "gmail_deadline"},
        {"$set": {"status": "confirmed", "title": "Launch — October 27",
                  "detail": "Confirmed by Sarah via Gmail. Previously October 20.", "updated_at": _iso(now)}},
    )
    await db.project_memory.update_many(
        {"project_id": pid, "category": "deadline", "title": "Launch — October 20"},
        {"$set": {"title": "Launch — October 27 (was Oct 20)", "status": "confirmed",
                  "detail": "Launch moved from October 20 to October 27, confirmed by Sarah.",
                  "updated_at": _iso(now)}},
    )
    state = proj.get("demo_state") or {}
    state["reply_received"] = True
    state["conflict_resolved"] = True
    await db.projects.update_one({"id": pid}, {"$set": {"demo_state": state, "updated_at": _iso(now)}})
    await _track(uid, "demo_conflict_resolved", pid)
    await _track(uid, "demo_completed", pid)
    return {"ok": True, "message": "Sarah confirmed October 27. Bracket resolved the conflict and updated project memory."}


class TrackIn(BaseModel):
    event: str
    project_id: str = ""


async def _track(uid: str, event: str, project_id: str = ""):
    try:
        await db.demo_funnel.insert_one({
            "id": _uuid(), "user_id": uid, "event": event,
            "project_id": project_id, "created_at": _iso(_now()),
        })
    except Exception:
        pass


@router.post("/track")
async def demo_track(payload: TrackIn, request: Request):
    user = await current_user(request, db)
    await _track(user["user_id"], payload.event, payload.project_id)
    return {"ok": True}
