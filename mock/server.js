/* Bracket mock API + static server.
   Serves frontend/build (or proxies nothing — the CRA dev server proxies /api
   here via src/setupProxy.js) and implements the v2 API contract
   (docs/API_V2.md) plus the v1 auth/payment endpoints the app still uses.

   node mock/server.js            → http://localhost:4300
   POST /api/__mock/scenario {name} switches edge-case states (see SCENARIOS). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { build, uid, mins, d, DAY } = require("./seed");

const PORT = Number(process.env.MOCK_PORT || 4300);
const BUILD = path.resolve(__dirname, "../frontend/build");

let S = build();
S.primaryIds = new Set([S.workspaces[0].id]);
let scenario = "default";
let loggedIn = true;
let sessionExpired = false;
let otpAttempts = 0;
const undoStack = {}; // review id → snapshot of memory before accept

const SCENARIOS = {
  default: "Everything normal (monthly plan)",
  trial: "Trial — 3 days left",
  trial_ended: "Trial ended — read-only",
  payment_failed: "Payment failed — retrying, grace period",
  canceled: "Subscription canceled — active until period end",
  expiring: "Workspace expiring (per-project plan ends soon)",
  archived: "Workspace archived",
  deletion_scheduled: "Workspace deletion scheduled",
  viewer: "You are a viewer (read-only)",
  plan_limit: "Plan limit reached (10 of 10 workspaces)",
  all_caught_up: "Overview — all caught up",
  first_sync: "Overview — first sync, learning",
  source_disconnected: "Overview — a source needs reconnecting",
  new_workspace: "New workspace, no sources",
  session_expired: "Session expired on next request",
  signed_out: "Signed out",
};

function applyScenario(name) {
  S = build();
  S.primaryIds = new Set([S.workspaces[0].id]);
  scenario = name;
  loggedIn = name !== "signed_out";
  sessionExpired = name === "session_expired";
  const ws = S.workspaces[0];
  if (name === "trial") Object.assign(S.billing, { plan: "trial", status: "trialing", trial_ends_at: d(9), renews_on: null, card: null, label: "Trial", amount: 0, invoices: [], workspaces: { used: 1, limit: 10 } });
  if (name === "trial_ended") Object.assign(S.billing, { plan: "trial", status: "expired", trial_ends_at: d(-1), renews_on: null, card: null, label: "Trial", amount: 0, invoices: [] });
  if (name === "payment_failed") Object.assign(S.billing, { status: "past_due", retry: { attempt: 1, of: 3, last_at: d(0), next_at: d(2), grace_ends_at: d(7) } });
  if (name === "canceled") Object.assign(S.billing, { status: "canceled", ends_on: d(39) });
  if (name === "expiring") Object.assign(ws, { status: "expiring", expires_at: d(5) }) && Object.assign(S.billing, { plan: "project", label: "Per project", amount: 199, interval: "project" });
  if (name === "archived") Object.assign(ws, { status: "archived", archived_at: d(-1) });
  if (name === "deletion_scheduled") Object.assign(ws, { status: "deletion_scheduled", deletion_at: d(30) });
  if (name === "viewer") ws.role = "viewer";
  if (name === "plan_limit") Object.assign(S.billing, { workspaces: { used: 10, limit: 10 } });
  if (name === "all_caught_up") { S.attention = []; S.reviews = []; S.memory.forEach((m) => { delete m.pending_change; }); S.updates.forEach((u) => (u.read = true)); }
  if (name === "first_sync") { S.attention = S.attention.slice(0, 1); S.sources[1].progress = { done: 1204, total: 3880 }; ws.learning = { text: "Slack 1,204 of 3,880 · Gmail done · about 6 min left", pct: 0.42, discovering: 3 }; S.categories = S.categories.slice(0, 3); }
  if (name === "source_disconnected") {
    const g = S.sources[0]; g.status = "error"; g.health = "reconnect"; g.error = "Google access expired";
    g.disconnected_at = new Date(Date.now() - 2 * 3600e3).toISOString();
  }
  if (name === "new_workspace") { S.workspaces[0] = { ...ws, name: "New workspace", client_name: "", initials: "NW", summary: "" }; S.sources = []; S.memory = []; S.attention = []; S.reviews = []; S.threads = []; S.events = []; S.files = []; S.updates = []; }
}

/* ───────────────────────── helpers ───────────────────────── */
class HttpError extends Error { constructor(status, detail, extra) { super(detail); this.status = status; this.extra = extra; } }
const ws = (id) => { const w = S.workspaces.find((x) => x.id === id); if (!w) throw new HttpError(404, "Workspace not found"); return w; };
const isPrimary = (id) => (S.primaryIds || new Set([S.workspaces[0].id])).has(id);
const readOnlyReason = (w) => {
  if (w.role === "viewer") return "viewer";
  if (S.billing.status === "expired") return "trial_ended";
  if (w.status === "archived") return "archived";
  if (w.status === "deletion_scheduled") return "deletion_scheduled";
  return null;
};
const guardWrite = (w) => { const r = readOnlyReason(w); if (r) throw new HttpError(403, "This workspace is read-only", { code: r }); };
const current = () => S.memory.filter((m) => m.status === "current");
const byId = (id) => S.memory.find((m) => m.id === id);
const pendingReviews = () => S.reviews.filter((r) => r.status === "pending");
const activeReviews = () => pendingReviews().filter((r) => !r.saved);
const pendingCats = () => {
  const c = {};
  activeReviews().forEach((r) => r.proposals.forEach((p) => { c[p.category] = (c[p.category] || 0) + 1; }));
  return c;
};
const categoriesWithCounts = () => {
  const pc = pendingCats();
  return S.categories.map((c) => {
    const items = current().filter((m) => m.category === c.key);
    const due = c.key === "commitment" ? items.filter((m) => m.state === "open" && m.due && new Date(m.due) - Date.now() < 7 * DAY).length : 0;
    const updatedNow = items.some((m) => Date.now() - new Date(m.changed_at) < 5 * 60e3);
    return { ...c, count: items.length, pending: pc[c.key] || 0, due, updated_now: updatedNow };
  });
};
const wsSummary = (w) => ({
  attention: isPrimary(w.id) ? S.attention.filter((a) => !a.saved && !(a.snoozed_until && new Date(a.snoozed_until) > Date.now())).length : (w.attention || 0),
  sources_label: isPrimary(w.id) ? S.sources.filter((s) => s.status !== "disconnected").map((s) => s.label).join(" · ") : (w.sources_label || ""),
  ...w, read_only: readOnlyReason(w),
  counts: isPrimary(w.id) ? {
    memory: current().length, pending: activeReviews().reduce((n, r) => n + r.proposals.length, 0),
    needs_review: activeReviews().reduce((n, r) => n + r.proposals.length, 0),
    recently_changed: current().filter((m) => Date.now() - new Date(m.changed_at) < 3 * DAY).length,
    conversations: S.threads.length ? S.conversationTotal : 0, needs_reply: S.threads.filter((t) => t.needs_reply).length,
    files: S.files.length, reviews: pendingReviews().length,
  } : { memory: 0, pending: 0, needs_review: 0, recently_changed: 0, conversations: 0, needs_reply: 0, files: 0, reviews: 0 },
});
const dataFor = (wid) => {
  if (isPrimary(wid)) return S;
  return { sources: [], memory: [], attention: [], reviews: [], threads: [], events: [], files: [], updates: [], categories: [], people: [], askHistory: [] };
};
const sourceLite = (s) => {
  const { threads, channels, notes, candidates, activity, ...rest } = s;
  return { ...rest, items: (threads || channels || notes || []).length };
};
const evidenceSource = (e) => S.sources.find((s) => s.id === e.source_id);

/* ───────────────────────── routes ───────────────────────── */
const routes = [];
const on = (method, pattern, fn) => {
  const keys = [];
  const rx = new RegExp("^" + pattern.replace(/:[a-z_]+/g, (k) => { keys.push(k.slice(1)); return "([^/]+)"; }) + "$");
  routes.push({ method, rx, keys, fn });
};

/* mock control */
on("GET", "/api/__mock/scenario", () => ({ current: scenario, scenarios: SCENARIOS }));
on("POST", "/api/__mock/scenario", ({ body }) => { applyScenario(body.name || "default"); return { current: scenario }; });

/* auth (v1 shapes) */
on("GET", "/api/auth/me", () => (loggedIn ? S.me : null));
on("POST", "/api/auth/logout", () => { loggedIn = false; return { ok: true }; });
on("POST", "/api/auth/login", ({ body }) => {
  if (body.password !== "bracket123" && body.password !== "password") {
    throw new HttpError(401, "That email and password don’t match.", { attempts_left: 3 });
  }
  loggedIn = true; sessionExpired = false; return { user: S.me, is_new: false };
});
on("POST", "/api/auth/otp/request", ({ body }) => {
  if (body.mode === "signup" && /maya@/.test(body.email || "")) throw new HttpError(409, "An account already exists for this email.", { code: "email_registered" });
  otpAttempts = 0; return { ok: true, ttl_minutes: 10, resend_in: 30, dev_code: "123456" };
});
on("POST", "/api/auth/otp/verify", ({ body }) => {
  if (body.code === "000000") throw new HttpError(410, "This code has expired.", { code: "expired" });
  if (body.code !== "123456") { otpAttempts++; throw new HttpError(400, "That code isn’t right.", { attempts_left: Math.max(0, 5 - otpAttempts) }); }
  loggedIn = true; sessionExpired = false; return { user: S.me, is_new: body.mode === "signup" };
});
on("PATCH", "/api/auth/me", ({ body }) => Object.assign(S.me, body));
on("POST", "/api/auth/password/set", () => { S.me.has_password = true; return { ok: true }; });
on("POST", "/api/v2/auth/password/forgot", () => ({ ok: true }));
on("POST", "/api/v2/auth/password/reset", ({ body }) => {
  if (body.token === "expired") throw new HttpError(410, "This reset link has expired.", { code: "expired" });
  loggedIn = true; return { ok: true, user: S.me };
});
on("GET", "/api/auth/claimable", () => []);
on("GET", "/api/auth/google/native/start", ({ q }) => ({ __redirect: `/auth/callback#session_id=mock&next=${encodeURIComponent(q.next || "/app")}` }));
on("POST", "/api/auth/google/exchange", () => { loggedIn = true; return { user: S.me, is_new: false }; });

/* invites */
on("GET", "/api/v2/invites/:token", ({ p }) => {
  if (p.token === "expired") throw new HttpError(410, "This invite has expired.", { code: "expired", inviter: "Maya Rao", workspace: "Fintech Landing Page Redesign" });
  return { token: p.token, inviter: "Maya Rao", inviter_email: "maya@northlight.studio", workspace: { id: "p1", name: "Fintech Landing Page Redesign", client_name: "Acme Finance" }, role: "editor", email: "sam@northlight.studio" };
});
on("POST", "/api/v2/invites/:token/accept", () => { loggedIn = true; return { ok: true, workspace_id: "p1", user: S.me }; });

/* account */
on("GET", "/api/v2/me/sessions", () => ({ sessions: S.sessions }));
on("POST", "/api/v2/me/sessions/sign-out-others", () => { const others = S.sessions.filter((s) => !s.current); S.sessions = S.sessions.filter((s) => s.current); return { ok: true, signed_out: others.length, devices: others.map((s) => s.device) }; });
on("GET", "/api/v2/me/notifications", () => S.notifications);
on("PATCH", "/api/v2/me/notifications", ({ body }) => {
  if (body.event) { const e = S.notifications.events.find((x) => x.key === body.event); if (e) e[body.channel] = !!body.value; }
  if (body.digest) Object.assign(S.notifications.digest, body.digest);
  return S.notifications;
});
on("POST", "/api/v2/me/export", () => ({ ok: true, email: S.me.email, ready_in: "about 10 minutes" }));
on("DELETE", "/api/v2/me", ({ body }) => { if ((body.confirm || "") !== "DELETE") throw new HttpError(400, "Type DELETE to confirm."); loggedIn = false; return { ok: true, deletes_on: d(7) }; });
on("POST", "/api/v2/contact", ({ body }) => { if (!body.email || !body.message) throw new HttpError(400, "Add your email and a message."); return { ok: true }; });

/* billing */
on("GET", "/api/v2/billing", () => S.billing);
on("POST", "/api/v2/billing/checkout", ({ body }) => {
  if (body.card && String(body.card).replace(/\s/g, "").endsWith("0002")) throw new HttpError(402, "Your card was declined. Try another card.", { code: "card_declined" });
  const cur = body.currency || S.billing.currency; const price = S.billing.prices[body.plan][cur];
  const firstCharge = S.billing.status === "trialing" ? S.billing.trial_ends_at : new Date().toISOString();
  Object.assign(S.billing, { plan: body.plan, status: "active", currency: cur, label: body.plan === "monthly" ? "Monthly" : "Per project", amount: price, interval: body.plan === "monthly" ? "month" : "project", renews_on: body.plan === "monthly" ? d(39) : null, trial_ends_at: null, first_charge_at: firstCharge, card: { brand: "Visa", last4: String(body.card || "4242").replace(/\s/g, "").slice(-4), exp: body.exp || "08/28", email: S.me.email } });
  delete S.billing.retry; return { ok: true, billing: S.billing };
});
on("PATCH", "/api/v2/billing", ({ body }) => { if (body.currency) { S.billing.currency = body.currency; S.billing.amount = S.billing.plan && S.billing.prices[S.billing.plan] ? S.billing.prices[S.billing.plan][body.currency] : 0; } return S.billing; });
on("POST", "/api/v2/billing/change", ({ body }) => { if (body.plan === S.billing.plan) return { ok: true, billing: S.billing }; S.billing.pending_change = { plan: body.plan, on: S.billing.renews_on }; return { ok: true, billing: S.billing }; });
on("POST", "/api/v2/billing/cancel", ({ body }) => { Object.assign(S.billing, { status: "canceled", ends_on: S.billing.renews_on || d(10), cancel_reason: body.reason }); S.billing.renews_on = null; return { ok: true, billing: S.billing }; });
on("POST", "/api/v2/billing/resume", () => { Object.assign(S.billing, { status: "active", renews_on: S.billing.ends_on || d(10) }); delete S.billing.ends_on; return { ok: true, billing: S.billing }; });
on("POST", "/api/v2/billing/retry", () => { S.billing.status = "active"; delete S.billing.retry; return { ok: true, billing: S.billing }; });

/* workspaces */
on("GET", "/api/v2/workspaces", () => ({ workspaces: S.workspaces.map(wsSummary), limit: S.billing.workspaces }));
on("POST", "/api/v2/workspaces", ({ body }) => {
  if (S.billing.workspaces.used >= S.billing.workspaces.limit) throw new HttpError(402, "You’ve reached your plan’s workspace limit.", { code: "plan_limit", used: S.billing.workspaces.used, limit: S.billing.workspaces.limit });
  const w = { id: uid("p"), name: body.name || "New workspace", client_name: body.client_name || "", initials: (body.client_name || body.name || "NW").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase(), role: "owner", status: "active", summary: "", created_at: new Date().toISOString(), memory_updated_at: null };
  S.workspaces.push(w); S.billing.workspaces.used++; return wsSummary(w);
});
on("GET", "/api/v2/w/:wid", ({ p }) => wsSummary(ws(p.wid)));
on("PATCH", "/api/v2/w/:wid", ({ p, body }) => { const w = ws(p.wid); guardWrite(w); Object.assign(w, body); return wsSummary(w); });
on("POST", "/api/v2/w/:wid/seen", ({ p }) => ({ previous: ws(p.wid).last_seen_prev || null }));
on("POST", "/api/v2/w/:wid/archive", ({ p }) => { const w = ws(p.wid); w.status = "archived"; w.archived_at = new Date().toISOString(); return wsSummary(w); });
on("POST", "/api/v2/w/:wid/unarchive", ({ p }) => {
  const w = ws(p.wid);
  if (S.billing.workspaces.used >= S.billing.workspaces.limit) throw new HttpError(402, "You’ve reached your plan’s workspace limit.", { code: "plan_limit" });
  w.status = "active"; delete w.archived_at; return wsSummary(w);
});
on("POST", "/api/v2/w/:wid/leave", ({ p }) => { S.workspaces = S.workspaces.filter((w) => w.id !== p.wid); return { ok: true }; });
on("POST", "/api/v2/w/:wid/delete", ({ p, body }) => { const w = ws(p.wid); if ((body.confirm || "") !== w.name) throw new HttpError(400, "Type the workspace name to confirm."); w.status = "deletion_scheduled"; w.deletion_at = d(7); const next = S.workspaces.find((x) => x.id !== w.id && x.status === "active"); return { ...wsSummary(w), next_workspace: next?.id || null }; });
on("POST", "/api/v2/w/:wid/restore", ({ p }) => { const w = ws(p.wid); w.status = "active"; delete w.deletion_at; return wsSummary(w); });
on("POST", "/api/v2/w/:wid/export", () => ({ ok: true, email: S.me.email, formats: ["md", "pdf", "json"] }));
on("GET", "/api/v2/w/:wid/settings", () => S.workspaceSettings);
on("PATCH", "/api/v2/w/:wid/settings", ({ p, body }) => { guardWrite(ws(p.wid)); return Object.assign(S.workspaceSettings, body); });

/* overview */
on("GET", "/api/v2/w/:wid/overview", ({ p }) => {
  const w = ws(p.wid); const D = dataFor(p.wid);
  const nowMs = Date.now();
  const live = (D.attention || []).filter((a) => !a.saved && !(a.snoozed_until && new Date(a.snoozed_until) > nowMs));
  const comingUp = current().filter((m) => isPrimary(p.wid) && m.category === "commitment" && m.state === "open" && !m.waiting_days)
    .sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity));
  const since = (D.events || []).filter((e) => e.short).slice(0, 4);
  return {
    workspace: wsSummary(w),
    attention: live,
    snoozed: (D.attention || []).filter((a) => a.snoozed_until && new Date(a.snoozed_until) > nowMs).length,
    saved: (D.attention || []).filter((a) => a.saved).length,
    coming_up: comingUp.map((m) => ({ id: m.id, title: m.short || m.title, due: m.due || null, direction: m.direction, at_risk: !!m.at_risk, waiting_days: m.waiting_days })),
    categories: isPrimary(p.wid) ? categoriesWithCounts() : [],
    since_last_visit: since,
    sources: (D.sources || []).map(sourceLite),
  };
});
on("GET", "/api/v2/w/:wid/attention", ({ p, q }) => {
  const A = dataFor(p.wid).attention || [];
  if (q.view === "snoozed") return { items: A.filter((a) => a.snoozed_until && new Date(a.snoozed_until) > Date.now()) };
  if (q.view === "saved") return { items: A.filter((a) => a.saved) };
  return { items: A };
});
on("POST", "/api/v2/w/:wid/attention/:aid/snooze", ({ p, body }) => { const a = S.attention.find((x) => x.id === p.aid); a.snoozed_until = body.until || d(1); return a; });
on("POST", "/api/v2/w/:wid/attention/:aid/save", ({ p }) => { const a = S.attention.find((x) => x.id === p.aid); a.saved = true; return a; });
on("POST", "/api/v2/w/:wid/attention/:aid/restore", ({ p }) => { const a = S.attention.find((x) => x.id === p.aid); delete a.snoozed_until; a.saved = false; return a; });
on("POST", "/api/v2/w/:wid/attention/:aid/dismiss", ({ p }) => { S.attention = S.attention.filter((x) => x.id !== p.aid); return { ok: true }; });

/* conflicts */
on("GET", "/api/v2/w/:wid/conflicts/:cid", ({ p }) => S.conflicts.find((c) => c.id === p.cid) || (() => { throw new HttpError(404, "Already resolved"); })());
on("POST", "/api/v2/w/:wid/conflicts/:cid/resolve", ({ p, body }) => {
  guardWrite(ws(p.wid));
  const c = S.conflicts.find((x) => x.id === p.cid); if (!c) throw new HttpError(409, "Already resolved.");
  const opt = c.options.find((o) => o.id === body.option); const at = new Date().toISOString();
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (body.option !== "ask") {
    S.conflicts = S.conflicts.filter((x) => x.id !== p.cid); S.attention = S.attention.filter((a) => a.action?.target !== p.cid);
    const co = byId("co3"); co.versions = [...(co.versions || []), { at: co.changed_at, title: co.title, superseded_at: at }];
    if (body.option === "move") { co.due = body.date; co.title = `Launch all three breakpoints — ${fmt(body.date)}.`; co.at_risk = false; }
    if (body.option === "split") { co.at_risk = false; S.memory.unshift({ id: uid("m"), category: "commitment", title: `Maya will deliver tablet layouts by ${fmt(body.date)}.`, short: "Tablet layouts to Sarah", owner: "Maya Rao", owed_to: "Sarah Chen", direction: "You → Acme Finance", due: body.date, state: "open", status: "current", confidence: "high", created_at: at, changed_at: at, history: [{ at, text: "Created when the timeline conflict was resolved" }], evidence: [], related: ["co3"] }); }
    if (body.option === "drop") { co.at_risk = false; S.reviews.forEach((r) => { if (r.id === "r1") r.status = "dismissed"; }); S.attention = S.attention.filter((a) => a.action?.target !== "r1"); }
    co.changed_at = at; co.history.unshift({ at, text: `Conflict resolved — ${opt.title.toLowerCase()}` });
  }
  S.events.unshift({ id: uid("ev"), at, kind: "conflict_resolved", title: body.option === "ask" ? "Reply drafted — timeline question for Sarah" : `Conflict resolved — ${opt.title.toLowerCase()}`, actor: { provider: "manual", label: "Maya Rao" }, meta: opt.effect, memory: body.option !== "ask", dot: "success" });
  return { ok: true, option: opt, draft_thread: "t1" };
});

/* categories + memory */
on("GET", "/api/v2/w/:wid/categories", ({ p }) => ({ categories: isPrimary(p.wid) ? categoriesWithCounts() : [], total: isPrimary(p.wid) ? current().length : 0 }));
on("POST", "/api/v2/w/:wid/categories/suggest", ({ body }) => ({ ok: true, name: body.name, message: "Thanks — Bracket will use this when it finds matching memory." }));
on("PATCH", "/api/v2/w/:wid/categories/:key", ({ p, body }) => { const c = S.categories.find((x) => x.key === p.key); Object.assign(c, body); return c; });
on("GET", "/api/v2/w/:wid/memory", ({ p, q }) => {
  if (!isPrimary(p.wid)) return { items: [], total: 0 };
  let items;
  const pend = [];
  pendingReviews().forEach((r) => r.proposals.forEach((pr) => pend.push({ id: `${r.id}:${pr.id}`, review_id: r.id, category: pr.category, title: pr.after, before: pr.before, op: pr.op, confidence: pr.confidence, status: "pending", created_at: r.detected.at, changed_at: r.detected.at, evidence: [{ provider: r.trigger.provider, author: r.trigger.from, where: r.trigger.subject, at: r.trigger.at, quote: "" }] })));
  if (q.view === "needs_review") items = pend;
  else if (q.view === "recent") items = current().filter((m) => Date.now() - new Date(m.changed_at) < 3 * DAY).sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  else if (q.view === "changed") items = current().filter((m) => m.versions || Date.now() - new Date(m.changed_at) < 3 * DAY);
  else if (q.view === "superseded") items = S.memory.filter((m) => m.versions).flatMap((m) => m.versions.map((v, i) => ({ id: `${m.id}~${i}`, current_id: m.id, category: m.category, title: v.title, status: "superseded", superseded_at: v.superseded_at, evidence: m.evidence })));
  else items = current();
  if (q.category) items = items.filter((m) => m.category === q.category);
  if (q.q) { const s = q.q.toLowerCase(); items = items.filter((m) => (m.title + " " + (m.detail || "") + " " + (m.evidence || []).map((e) => e.quote + " " + e.author).join(" ")).toLowerCase().includes(s)); }
  return { items, total: items.length };
});
on("GET", "/api/v2/w/:wid/memory/:mid", ({ p }) => {
  const m = byId(p.mid); if (!m) throw new HttpError(404, "Memory item not found");
  return { ...m, related: (m.related || []).map((id) => byId(id)).filter(Boolean).map((r) => ({ id: r.id, category: r.category, title: r.short || r.title })),
    evidence: m.evidence.map((e) => ({ ...e, source_label: evidenceSource(e)?.label })), person: m.person_id ? S.people.find((x) => x.id === m.person_id) : null };
});
on("POST", "/api/v2/w/:wid/memory", ({ p, body }) => {
  guardWrite(ws(p.wid));
  const it = { id: uid("m"), category: body.category, title: body.title, detail: body.detail || "", status: "current", confidence: "high", created_at: new Date().toISOString(), changed_at: new Date().toISOString(), history: [{ at: new Date().toISOString(), text: "Added manually by Maya" }], evidence: [{ id: uid("e"), provider: "manual", author: "Maya Rao", where: "Added in Bracket", at: new Date().toISOString(), quote: body.title }], related: [] };
  S.memory.unshift(it); return it;
});
on("PATCH", "/api/v2/w/:wid/memory/:mid", ({ p, body }) => {
  guardWrite(ws(p.wid)); const m = byId(p.mid);
  const prev = m.title;
  Object.assign(m, body); m.changed_at = new Date().toISOString();
  m.history.unshift({ at: m.changed_at, text: body.title && body.title !== prev ? `Edited by Maya — was “${prev}”` : "Edited by Maya" });
  S.events.unshift({ id: uid("ev"), at: m.changed_at, kind: "edited", title: `Memory edited — ${m.short || m.title}`, actor: { provider: "manual", label: "Maya Rao" }, meta: "Edited manually", memory: true, memory_id: m.id });
  return m;
});
on("POST", "/api/v2/w/:wid/memory/:mid/incorrect", ({ p, body }) => {
  guardWrite(ws(p.wid)); const m = byId(p.mid); m.status = "dismissed"; m.dismiss_reason = body.reason;
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "marked_incorrect", title: `Marked incorrect — ${m.short || m.title}`, actor: { provider: "manual", label: "Maya Rao" }, meta: body.reason || "", memory: true });
  return { ok: true };
});
on("POST", "/api/v2/w/:wid/memory/:mid/restore", ({ p }) => { const m = byId(p.mid); m.status = "current"; return m; });
on("GET", "/api/v2/w/:wid/people/:pid", ({ p }) => {
  const pe = S.people.find((x) => x.id === p.pid); if (!pe) throw new HttpError(404, "Person not found");
  const first = pe.name.split(" ")[0];
  const open = [];
  current().filter((m) => m.category === "commitment" && m.state === "open" && (m.owner === pe.name || m.owed_to === pe.name)).forEach((m) => open.push({ kind: "Commitment", text: m.owner === "Maya Rao" ? `You owe: ${(m.short || m.title).toLowerCase()}${m.due ? " by " + new Date(m.due).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""}` : `${first} owes: ${(m.short || m.title).toLowerCase()}${m.waiting_days ? " · " + m.waiting_days + " days late" : ""}`, id: m.id }));
  S.threads.filter((t) => t.needs_reply && t.who === pe.name).forEach((t) => open.push({ kind: "Conversation", text: `Waiting on you: reply about ${t.id === "t1" ? "tablet" : t.title.toLowerCase()}`, thread_id: t.id }));
  const recent = S.threads.filter((t) => t.who === pe.name || (t.participants || "").includes(pe.name)).slice(0, 3).map((t) => ({ id: t.id, provider: t.provider, title: t.title, at: t.at }));
  return { ...pe, open, recent };
});
on("GET", "/api/v2/w/:wid/people", () => ({ people: S.people }));
/* Source viewer — the message/note an evidence quote came from, in context. */
on("GET", "/api/v2/w/:wid/evidence/:eid", ({ p }) => {
  let ev = null; let owner = null;
  S.memory.forEach((m) => (m.evidence || []).forEach((e) => { if (e.id === p.eid) { ev = e; owner = m; } }));
  if (!ev) throw new HttpError(404, "Evidence not found");
  const from = S.memory.filter((m) => (m.evidence || []).some((e) => e.quote === ev.quote)).map((m) => ({ id: m.id, category: S.categories.find((c) => c.key === m.category)?.label || m.category, text: m.short ? `${m.title}` : m.title }));
  const at = new Date(ev.at);
  const hm = (d) => d.toTimeString().slice(0, 5);
  if (ev.provider === "slack") {
    const before = new Date(at.getTime() - 8 * 60e3); const after = new Date(at.getTime() + 11 * 60e3);
    return { provider: "slack", label: "Slack", title: ev.where, meta: `Thread · ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${hm(before)}–${hm(after)} · 6 messages`, link: "https://slack.com",
      messages: [
        { author: "Sarah Chen", at: before.toISOString(), text: "Can we see mobile before the review on Monday?" },
        { author: ev.author, at: ev.at, text: ev.quote, highlight: true },
        { author: "James Park", at: after.toISOString(), text: "👍 that works for us" },
      ], memory_from: from };
  }
  if (ev.provider === "notes") {
    const note = (S.sources.find((s) => s.provider === "notes")?.notes || []).find((n) => n.id === ev.ref_id);
    return { provider: "notes", label: "Note", title: ev.where, meta: `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · added by ${ev.author}`, note: note ? { body: note.body, highlight: ev.quote } : { body: ev.quote, highlight: ev.quote }, memory_from: from };
  }
  return { provider: ev.provider, label: ev.provider === "gmail" ? "Email" : "Source", title: ev.where, meta: `${ev.author} · ${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${hm(at)}`, link: "https://mail.google.com",
    messages: [{ author: ev.author, at: ev.at, text: ev.quote, highlight: true }], memory_from: from };
});

/* reviews */
on("GET", "/api/v2/w/:wid/reviews", ({ p }) => ({ reviews: (dataFor(p.wid).reviews || []).filter((r) => r.status === "pending").map((r) => ({ id: r.id, title: r.title, label: r.label, kind: r.kind, count: r.proposals.length, at: r.detected.at, saved: !!r.saved })) }));
on("GET", "/api/v2/w/:wid/reviews/:rid", ({ p }) => {
  const r = S.reviews.find((x) => x.id === p.rid); if (!r) throw new HttpError(404, "This review no longer exists.");
  if (r.status !== "pending") throw new HttpError(409, r.status === "accepted" ? "Already accepted — by you, just now." : "This review was already resolved.", { code: "resolved", by: r.resolved_by || "Maya Rao" });
  const q = pendingReviews(); return { ...r, position: { index: q.findIndex((x) => x.id === r.id) + 1, total: q.length }, next_id: q[q.findIndex((x) => x.id === r.id) + 1]?.id || null };
});
on("POST", "/api/v2/w/:wid/reviews/:rid/accept", ({ p, body }) => {
  guardWrite(ws(p.wid));
  const r = S.reviews.find((x) => x.id === p.rid);
  if (!r || r.status !== "pending") throw new HttpError(409, "This review was already resolved.");
  const selected = new Set(body.selected || r.proposals.map((x) => x.id));
  const edits = body.edits || {};
  undoStack[r.id] = JSON.parse(JSON.stringify({ memory: S.memory, attention: S.attention, updates: S.updates }));
  const at = new Date().toISOString();
  const applied = [];
  r.proposals.forEach((pr) => {
    if (!selected.has(pr.id)) return;
    const text = edits[pr.id] || pr.after;
    if (pr.target && byId(pr.target)) {
      const m = byId(pr.target);
      m.versions = [...(m.versions || []), { at: m.changed_at, title: m.title, superseded_at: at }];
      m.history.unshift({ at, text: `Changed from “${m.title}” — accepted by Maya` });
      m.title = text; m.changed_at = at; delete m.pending_change; if (pr.op === "conflict") m.at_risk = true;
    } else {
      S.memory.unshift({ id: uid("m"), category: pr.category, title: text, status: "current", confidence: pr.confidence, created_at: at, changed_at: at, history: [{ at, text: "Added from review — accepted by Maya" }], evidence: [{ id: uid("e"), provider: r.trigger.provider, author: r.trigger.from, where: r.trigger.subject, at: r.trigger.at, quote: r.trigger.body.find((b) => b.tags)?.text || "", source_id: r.trigger.source_id }], related: [] });
    }
    applied.push(pr);
  });
  S.memory.forEach((m) => { if (m.pending_change?.review_id === r.id) delete m.pending_change; });
  r.status = "accepted"; r.resolved_at = at;
  S.attention = S.attention.filter((a) => a.action?.target !== r.id);
  S.events.unshift({ id: uid("ev"), short: `You accepted ${applied.length} updates from ${r.trigger.from.split(" ")[0]}’s ${r.id === "r1" ? "tablet request" : "message"}`, icon: "mail", at, kind: "changes_accepted", title: `Changes accepted — ${r.title.toLowerCase().replace(/^sarah asked to /, "")}`, actor: { provider: r.trigger.provider, label: r.trigger.from }, meta: `Accepted by Maya Rao · ${applied.length} memories updated`, memory: true, dot: "success", review_id: r.id,
    detail: { heading: r.title, eyebrow: "Changes accepted", when: at, accepted_by: "Maya Rao", triggered_by: `${r.trigger.provider === "gmail" ? "Email" : "Message"} from ${r.trigger.from}`, changes: applied.map((x) => ({ category: S.categories.find((c) => c.key === x.category)?.label || x.category, before: x.before || "", after: edits[x.id] || x.after })), source: { provider: r.trigger.provider, label: r.trigger.from, quote: r.trigger.body.find((b) => b.tags)?.text || "" }, restorable: true } });
  const cats = {}; applied.forEach((x) => { const l = S.categories.find((c) => c.key === x.category)?.label || x.category; cats[l] = (cats[l] || 0) + 1; });
  return { ok: true, accepted: applied.length, dismissed: r.proposals.length - applied.length, impact: Object.entries(cats).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ") };
});
on("POST", "/api/v2/w/:wid/reviews/:rid/undo", ({ p }) => {
  const snap = undoStack[p.rid]; if (!snap) throw new HttpError(409, "Nothing to undo.");
  Object.assign(S, snap); const r = S.reviews.find((x) => x.id === p.rid); r.status = "pending"; delete undoStack[p.rid];
  S.events = S.events.filter((e) => !(e.review_id === p.rid && e.kind === "changes_accepted"));
  return { ok: true };
});
on("POST", "/api/v2/w/:wid/reviews/:rid/dismiss", ({ p, body }) => {
  guardWrite(ws(p.wid)); const r = S.reviews.find((x) => x.id === p.rid); r.status = "dismissed"; r.dismiss_reason = body.reason;
  S.memory.forEach((m) => { if (m.pending_change?.review_id === r.id) delete m.pending_change; });
  S.attention = S.attention.filter((a) => a.action?.target !== r.id);
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "dismissed", title: `Changes dismissed — ${r.title}`, actor: { provider: r.trigger.provider, label: r.trigger.from }, meta: `Dismissed by Maya · reason: ${body.reason || "not specified"}${body.note ? " — " + body.note : ""}`, memory: true });
  return { ok: true };
});
on("POST", "/api/v2/w/:wid/reviews/:rid/save", ({ p }) => { const r = S.reviews.find((x) => x.id === p.rid); r.saved = true; const a = S.attention.find((x) => x.action?.target === r.id); if (a) a.saved = true; return { ok: true }; });

/* conversations */
on("GET", "/api/v2/w/:wid/threads", ({ p, q }) => {
  let T = dataFor(p.wid).threads || [];
  const counts = { all: isPrimary(p.wid) ? S.conversationTotal : 0, needs_reply: T.filter((t) => t.needs_reply).length, gmail: T.filter((t) => t.provider === "gmail").length, slack: T.filter((t) => t.provider === "slack").length, notes: T.filter((t) => t.provider === "notes").length };
  if (q.filter === "needs_reply") T = T.filter((t) => t.needs_reply);
  else if (q.filter && q.filter !== "all") T = T.filter((t) => t.provider === q.filter);
  return { threads: T.map(({ messages, ...t }) => t), counts };
});
on("GET", "/api/v2/w/:wid/threads/:tid", ({ p }) => { const t = S.threads.find((x) => x.id === p.tid); if (!t) throw new HttpError(404, "Conversation not found"); return t; });
on("POST", "/api/v2/w/:wid/threads/:tid/draft", ({ p, body }) => {
  const t = S.threads.find((x) => x.id === p.tid);
  const first = (t.who || "").split(" ")[0] || "there";
  const note = "Highlighted dates are suggestions — Bracket doesn’t know your capacity.";
  const ins = body.instruction || "";
  if (p.tid === "t4" || /follow/.test(ins)) return { label: `Draft follow-up to ${first}`, to: t.to_email, via: "gmail", note,
    based_on: [{ provider: "gmail", label: "Promised Sep 29", memory_id: "co2" }, { provider: "notes", label: "Mobile due Oct 10", memory_id: "co1" }],
    body: "Hi Sarah,\n\nQuick nudge on the brand assets (logo files and fonts) — we need them to finalise the editorial homepage ahead of Friday’s mobile screens. Could you send them by [[Wednesday]]?\n\nThanks,\nMaya" };
  if (p.tid === "t1") {
    const m = ins.match(/resolve-(\w+)/); const date = (ins.match(/date=([\d-]+)/) || [])[1];
    const dl = date ? new Date(date + "T09:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
    let text = "Hi Sarah,\n\nGlad the editorial direction landed well. Happy to add tablet layouts. Our current agreement covers desktop and mobile within the two-week timeline (launch Oct 17), so tablet would be an addition. Two options:\n\n1. Keep Oct 17 for desktop and mobile, and deliver tablet by [[Oct 24]].\n2. Move the full launch to [[Oct 22]] with all three breakpoints.\n\nMobile screens are still on track for Friday. Could you also send over the brand assets when you get a chance?\n\nBest,\nMaya";
    if (m && m[1] === "split") text = `Hi Sarah,\n\nHappy to add tablet layouts. To keep the launch on Oct 17, we’ll ship desktop and mobile then and deliver tablet by [[${dl || "Oct 24"}]].\n\nMobile screens are still on track for Friday.\n\nBest,\nMaya`;
    if (m && m[1] === "move") text = `Hi Sarah,\n\nHappy to add tablet layouts. To ship all three breakpoints together, we’ll move the launch to [[${dl || "Oct 22"}]].\n\nMobile screens are still on track for Friday.\n\nBest,\nMaya`;
    if (m && m[1] === "drop") text = "Hi Sarah,\n\nThanks for the note on tablet. To keep the two-week timeline, we’ll stay with desktop and mobile for the Oct 17 launch — happy to scope tablet as a follow-up.\n\nBest,\nMaya";
    return { label: "Draft reply to Sarah", to: t.to_email, via: "gmail", note,
      based_on: [{ provider: "gmail", label: "Scope · Sep 12", memory_id: "sc1" }, { provider: "notes", label: "Timeline · Oct 3", memory_id: "co3" }, { provider: "slack", label: "Mobile due Oct 10", memory_id: "co1" }], body: text };
  }
  if (t.provider === "slack") return { label: "Draft reply in thread", to: t.channel, via: "slack", based_on: [], note: null,
    body: "Confirmed: testimonials will have name, role, quote and company logo. Dev will set up the CMS collection today." };
  if (t.provider === "notes") return { label: "Draft message", to: "", via: "copy", based_on: [], note: "Notes can’t send — copy this into your email.", body: `Hi all,\n\nRecap from ${t.title}: Lighthouse 90+ on mobile, Webflow CMS for testimonials, and review schema on the homepage.\n\nBest,\nMaya` };
  return { label: `Draft reply to ${first}`, to: t.to_email, via: t.provider, based_on: [], note: null, body: `Hi ${first},\n\nThanks for the note — I’ll get back to you shortly.\n\nBest,\nMaya` };
});
on("GET", "/api/v2/w/:wid/message-templates", () => ({ templates: [
  { id: "timeline", label: "Timeline proposal", to: "Sarah Chen <sarah.chen@acmefinance.com>", subject: "Revised timeline for tablet layouts", body: "Hi Sarah,\n\nAs promised, here’s the revised timeline with tablet included: desktop and mobile on Oct 17, tablet by Oct 24.", remember: [{ category: "Commitments", text: "Tablet by Oct 24 (once sent)" }] },
  { id: "assets", label: "Brand assets follow-up", to: "Sarah Chen <sarah.chen@acmefinance.com>", subject: "Brand assets", body: "Hi Sarah,\n\nQuick nudge on the logo files and fonts — could you send them by Wednesday?\n\nThanks,\nMaya", remember: [] },
  { id: "weekly", label: "Weekly update", to: "Sarah Chen <sarah.chen@acmefinance.com>, James Park <james.park@acmefinance.com>", subject: "Weekly update — Fintech landing page", body: "Hi both,\n\nThis week: editorial homepage direction confirmed, mobile screens on track for Friday, testimonials CMS in progress.\n\nNext: tablet decision and brand assets.\n\nBest,\nMaya", remember: [] },
] }));
on("POST", "/api/v2/w/:wid/threads/:tid/send", ({ p, body }) => {
  guardWrite(ws(p.wid));
  if (/fail/i.test(body.body || "")) throw new HttpError(502, "Gmail didn’t accept the message. Your draft is kept.", { code: "send_failed" });
  const t = S.threads.find((x) => x.id === p.tid);
  t.messages.push({ id: uid("mm"), author: "Maya Rao", at: new Date().toISOString(), body: [{ text: body.body.replace(/\[\[|\]\]/g, "") }], sent_by_bracket: true });
  t.needs_reply = false; t.count++;
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "email_sent", title: `${t.provider === "slack" ? "Message" : "Email"} sent — ${t.title}`, actor: { provider: t.provider, label: "Maya Rao" }, meta: "Sent from Bracket", source: t.provider });
  return { ok: true, sent_at: new Date().toISOString(), link: t.provider === "gmail" ? "https://mail.google.com" : null };
});
on("POST", "/api/v2/w/:wid/messages", ({ p, body }) => {
  guardWrite(ws(p.wid));
  const t = { id: uid("t"), provider: body.via || "gmail", kind: "email", title: body.subject || "New message", who: body.to, participants: `Maya Rao, ${body.to}`, count: 1, at: new Date().toISOString(), started_at: new Date().toISOString(), preview: (body.body || "").slice(0, 80), needs_reply: false, earlier: 0,
    messages: [{ id: uid("mm"), author: "Maya Rao", at: new Date().toISOString(), body: [{ text: body.body }], sent_by_bracket: true }], would_change: [], created: [], referenced: [] };
  S.threads.unshift(t); S.conversationTotal++; return t;
});

/* ask */
const askAnswers = {};
function answerFor(wid, qtext) {
  const id = uid("q");
  const base = { id, question: qtext, at: new Date().toISOString() };
  const syncing = S.workspaces[0].learning && S.sources.find((s) => s.status === "syncing" && s.progress && s.progress.done / s.progress.total < 0.5);
  const partial = syncing ? { source: syncing.label, pct: Math.round((syncing.progress.done / syncing.progress.total) * 100) } : null;
  if (!isPrimary(wid) || !current().length) return { ...base, status: "no_answer", title: "Bracket couldn’t find this in your sources", answer: "Nothing in your connected sources mentions this yet. If it was discussed elsewhere, add it as a note or connect the source." };
  if (/error|fail/i.test(qtext)) return { ...base, status: "error" };
  if (/payment|invoice schedule|weather|stock|recipe/i.test(qtext)) return { ...base, status: "no_answer", title: "Bracket couldn’t find this in your sources", answer: "Nothing in Gmail, Slack or Notes mentions a payment schedule for Acme Finance. If it was discussed elsewhere, add it as a note or connect the source." };
  if (/launch date|when.*launch/i.test(qtext)) return { ...base, status: "conflict", basis: { memories: 4, sources: 2 }, title: "Sources disagree on the launch date",
    answer: "Kickoff notes say Oct 17 [1]. A later Slack message from James says “end of October” [2]. Bracket hasn’t chosen one — the most recent isn’t necessarily the agreed one.",
    sources: [{ n: 1, provider: "notes", label: "Kickoff call notes", meta: "Oct 3 · added by Maya Rao" }, { n: 2, provider: "slack", label: "#acme-redesign — James Park", meta: "Yesterday 16:40" }], partial };
  if (/tablet/i.test(qtext) && /change|add/i.test(qtext)) return { ...base, status: "answered", kind: "list", basis: { memories: 12, sources: 3 }, lead: "Five things in memory would change:",
    rows: [{ label: "Scope", text: "Desktop, tablet and mobile", cite: 1 }, { label: "Deliverables", text: "+ Tablet layouts for the homepage", cite: 1 }, { label: "Requirements", text: "+ Responsive at 768–1024px", cite: 1 }, { label: "Commitments", text: "Oct 17 launch is at risk", cite: 2 }, { label: "Contract", text: "Tablet isn’t in the signed SOW", cite: 3 }],
    uncertain: "No estimate exists for tablet effort, so the new date is unknown.", confidence: "medium",
    sources: [{ n: 1, provider: "gmail", label: "Re: Homepage direction + next steps — Sarah Chen", meta: "Today, 09:41", excerpt: "Can we include tablet layouts as well? Ideally we’d still like to keep the two-week timeline.", highlight: "Can we include tablet layouts as well?", memory: [{ category: "Scope", text: "Tablet layouts requested (pending)" }] },
      { n: 2, provider: "notes", label: "Kickoff call notes", meta: "Oct 3 · added by Maya Rao", note_id: "n1", excerpt: S.sources.find((s) => s.id === "s_notes")?.notes?.[0]?.body, highlight: "Timeline: 2 weeks from today → launch Fri Oct 17", memory: [{ category: "Commitments", text: "Launch two weeks after kickoff — Oct 17." }] },
      { n: 3, provider: "file", label: "SOW_signed.pdf", meta: "Page 2 · uploaded Oct 2", excerpt: "Deliverables: responsive marketing homepage (desktop, mobile) and four inner pages.", highlight: "(desktop, mobile)", memory: [{ category: "Scope", text: "Desktop and mobile layouts are included" }] }],
    actions: [{ label: "Review the 5 changes", kind: "review", target: "r1" }, { label: "Draft a reply", kind: "reply", target: "t1" }], next: ["What would tablet cost?", "Draft a reply proposing a new date"], partial };
  if (/scope/i.test(qtext)) return { ...base, status: "answered", basis: { memories: 6, sources: 2 }, lead: "Desktop and mobile layouts for the homepage and four inner pages.",
    paragraphs: [{ text: "The agreed scope covers desktop and mobile for the marketing homepage plus About, Pricing, Security and Contact.", cites: [1] }, { text: "Copywriting and a Webflow build with CMS are included; the blog is out of scope.", cites: [2] }, { text: "Tablet was requested today and is waiting for your review.", cites: [3] }],
    uncertain: null, confidence: "high",
    sources: [{ n: 1, provider: "gmail", label: "Proposal — Acme Finance website", meta: "James Park · Sep 12", excerpt: "Attached is the proposal covering desktop and mobile. Homepage + 4 inner pages as outlined.", highlight: "Homepage + 4 inner pages as outlined.", memory: [{ category: "Scope", text: "Marketing homepage plus four inner pages" }] },
      { n: 2, provider: "notes", label: "Kickoff call notes", meta: "Oct 3 · added by Maya Rao", excerpt: S.sources.find((s) => s.id === "s_notes")?.notes?.[0]?.body, highlight: "Build in Webflow; perf + SEO are priorities", memory: [{ category: "Scope", text: "Build in Webflow, including CMS setup" }] },
      { n: 3, provider: "gmail", label: "Re: Homepage direction + next steps — Sarah Chen", meta: "Today, 09:41", excerpt: "Can we include tablet layouts as well?", highlight: "Can we include tablet layouts as well?", memory: [{ category: "Scope", text: "Tablet layouts requested (pending)" }] }],
    next: ["What changes if we add tablet?", "What’s out of scope?"], partial };
  return { ...base, status: "answered", basis: { memories: 39, sources: 3 }, lead: "Yes — for desktop and mobile only.",
    paragraphs: [{ text: "At the kickoff call on Oct 3 you agreed to launch two weeks later, on Oct 17.", cites: [1] }, { text: "Sarah confirmed the same day by email.", cites: [2] }, { text: "That estimate covered desktop and mobile. Today Sarah asked to add tablet while “keeping the two-week timeline” —", cites: [3], tail: "that combination hasn’t been agreed yet." }],
    uncertain: "No message says whether “two weeks” counts from kickoff or from design approval. Bracket assumed kickoff, because that’s how the notes describe it.", confidence: "medium",
    sources: [{ n: 1, provider: "notes", label: "Kickoff call notes", meta: "Oct 3 · added by Maya Rao", note_id: "n1", excerpt: S.sources.find((s) => s.id === "s_notes")?.notes?.[0]?.body, highlight: "Timeline: 2 weeks from today → launch Fri Oct 17", attendees: "Oct 3 · Maya Rao, Sarah Chen, James Park", memory: [{ category: "Commitments", text: "Launch two weeks after kickoff — Oct 17." }] },
      { n: 2, provider: "gmail", label: "Re: Kickoff recap — Sarah Chen", meta: "Oct 3, 18:02", excerpt: "Launch on the 17th works. Friday works for mobile — thanks Maya.", highlight: "Launch on the 17th works.", memory: [{ category: "Commitments", text: "Mobile screens to Sarah by Fri Oct 10" }] },
      { n: 3, provider: "gmail", label: "Re: Homepage direction + next steps — Sarah Chen", meta: "Today, 09:41", excerpt: "Can we include tablet layouts as well? Ideally we’d still like to keep the two-week timeline.", highlight: "Ideally we’d still like to keep the two-week timeline.", memory: [{ category: "Scope", text: "Tablet layouts requested (pending)" }] }],
    next: ["What changes if we add tablet?", "Draft a reply proposing a new date"], partial };
}
on("GET", "/api/v2/w/:wid/ask/history", ({ p }) => ({ items: (dataFor(p.wid).askHistory || []) }));
on("GET", "/api/v2/w/:wid/ask/:qid", ({ p }) => {
  if (askAnswers[p.qid]) return askAnswers[p.qid];
  const h = (S.askHistory || []).find((x) => x.id === p.qid); if (!h) throw new HttpError(404, "Question not found");
  const a = { ...answerFor(p.wid, h.question), id: h.id, at: h.at }; askAnswers[h.id] = a; return a;
});
on("POST", "/api/v2/w/:wid/ask", ({ p, body }) => {
  const qtext = (body.question || "").trim();
  if (qtext.length < 3) throw new HttpError(400, "Ask a full question.");
  const a = answerFor(p.wid, qtext);
  if (a.status !== "error") { askAnswers[a.id] = a; if (isPrimary(p.wid)) S.askHistory.unshift({ id: a.id, question: qtext, at: a.at }); }
  if (a.status === "error") throw new HttpError(503, "Bracket couldn’t answer right now.", { code: "ask_failed" });
  return a;
});
on("POST", "/api/v2/w/:wid/ask/:qid/feedback", () => ({ ok: true }));

/* timeline */
const TL_TYPES = {
  changes: (e) => e.kind === "change_detected",
  memory: (e) => !!e.memory,
  messages: (e) => /email|message/.test(e.kind),
  notes: (e) => /note|file/.test(e.kind),
  sources: (e) => !!e.system,
};
on("GET", "/api/v2/w/:wid/timeline", ({ p, q }) => {
  const all = dataFor(p.wid).events || [];
  let E = all;
  if (q.memory_only === "1") E = E.filter((e) => e.memory);
  if (q.source && q.source !== "all") E = E.filter((e) => e.actor?.provider === q.source || e.source === q.source);
  if (q.type && q.type !== "all" && TL_TYPES[q.type]) E = E.filter(TL_TYPES[q.type]);
  if (q.range) { const days = { "7d": 7, "30d": 30, "90d": 90 }[q.range]; if (days) E = E.filter((e) => Date.now() - new Date(e.at) < days * DAY); }
  if (q.q) { const s = q.q.toLowerCase(); E = E.filter((e) => (e.title + " " + (e.meta || "") + " " + (e.actor?.label || "")).toLowerCase().includes(s)); }
  const counts = { all: all.length + 52, changes: all.filter(TL_TYPES.changes).length + 5, memory: all.filter(TL_TYPES.memory).length + 11, messages: all.filter(TL_TYPES.messages).length + 25, notes: all.filter(TL_TYPES.notes).length + 4, sources: all.filter(TL_TYPES.sources).length + 5 };
  return { events: E, has_more: !q.q && q.type !== "changes", counts };
});
on("GET", "/api/v2/w/:wid/timeline/:eid", ({ p }) => {
  const e = S.events.find((x) => x.id === p.eid); if (!e) throw new HttpError(404, "Event not found");
  if (e.detail) return e;
  if (e.kind === "sync") return { ...e, detail: { kind: "sync", eyebrow: "Source synced", heading: e.title, rows: [["When", e.at], ["Source", e.actor.label], ["Read", "38 new messages"], ["Found", "1 decision · 0 conflicts"]], result: [{ category: "Decisions", text: "Build in Webflow (not Framer) — added automatically, high confidence" }], source_id: e.source === "slack" ? "s_slack" : "s_gmail" } };
  return { ...e, detail: { heading: e.title.split(" — ")[1] || e.title, eyebrow: e.title.split(" — ")[0], when: e.at, triggered_by: e.actor?.label, changes: [], source: e.actor ? { provider: e.actor.provider, label: e.actor.label, quote: e.meta } : null, restorable: false, system: e.system } };
});
on("POST", "/api/v2/w/:wid/timeline/:eid/restore", ({ p }) => {
  guardWrite(ws(p.wid)); const e = S.events.find((x) => x.id === p.eid);
  if (!e?.detail?.restorable) throw new HttpError(400, "This event can’t be restored.");
  const at = new Date().toISOString();
  if (e.id === "ev4") { const m = byId("de1"); m.versions = [...(m.versions || []), { at: m.changed_at, title: m.title, superseded_at: at }]; m.title = "Homepage uses a classic, image-led hero"; m.changed_at = at; m.history.unshift({ at, text: "Restored previous version — by Maya" }); }
  const ne = { id: uid("ev"), at, kind: "restored", title: `Version restored — ${(e.detail.heading || "").toLowerCase().replace(" is now editorial", " is classic again")}`, actor: { provider: e.actor.provider, label: `${e.actor.label} · ${new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }, meta: `Restored by Maya Rao · conflicts with ${e.actor.label.split(" ")[0]}’s ${new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} email`, memory: true, dot: "info", restored_from: e.id,
    detail: { heading: "Previous version restored", eyebrow: "Version restored", when: at, accepted_by: "Maya Rao", triggered_by: "Restored from Timeline", changes: (e.detail.changes || []).map((c) => ({ category: c.category, before: c.after, after: c.before })), restorable: false, undo_of: e.id } };
  S.events.unshift(ne);
  return { ok: true, event: ne, updated: (e.detail.changes || []).length };
});
on("POST", "/api/v2/w/:wid/timeline/:eid/undo-restore", ({ p }) => {
  const e = S.events.find((x) => x.id === p.eid);
  if (e?.restored_from === "ev4") { const m = byId("de1"); m.title = "Homepage direction is editorial"; m.changed_at = new Date().toISOString(); }
  S.events = S.events.filter((x) => x.id !== p.eid);
  return { ok: true };
});
on("POST", "/api/v2/w/:wid/timeline/export", ({ body }) => ({ ok: true, format: body.format || "csv", rows: S.events.length, url: null, email: S.me.email }));

/* sources */
const srcOf = (sid) => { const s = S.sources.find((x) => x.id === sid); if (!s) throw new HttpError(404, "Source not found"); return s; };
const memFromSource = (sid) => S.memory.filter((m) => m.status === "current" && (m.evidence || []).some((e) => e.source_id === sid));
const onlyFrom = (sid) => memFromSource(sid).filter((m) => (m.evidence || []).every((e) => e.source_id === sid));
const listOf = (s) => s.threads || s.channels || s.notes || [];
on("GET", "/api/v2/w/:wid/sources", ({ p }) => ({ sources: (dataFor(p.wid).sources || []).map(sourceLite), connectors: S.connectors }));
on("GET", "/api/v2/w/:wid/sources/:sid", ({ p }) => {
  const s = srcOf(p.sid);
  const learned = memFromSource(s.id);
  return { ...s, impact: { total: s.learned?.total ?? learned.length, only_here: s.provider === "gmail" ? 14 : onlyFrom(s.id).length } };
});
on("GET", "/api/v2/w/:wid/sources/:sid/items/:tid/impact", ({ p }) => {
  const s = srcOf(p.sid); const t = listOf(s).find((x) => x.id === p.tid);
  const total = t?.memories ?? 0; const only = Math.min(2, total);
  return { title: t?.subject || t?.name || t?.title, from: t?.from, messages: t?.messages, total, supported_elsewhere: total - only, only_here: only };
});
on("PATCH", "/api/v2/w/:wid/sources/:sid", ({ p, body }) => { const s = srcOf(p.sid); if (body.auto_include) s.auto_include = { ...(s.auto_include || {}), ...body.auto_include }; if (body.permissions) Object.assign(s.permissions, body.permissions); return s; });
on("POST", "/api/v2/w/:wid/sources/:sid/sync", ({ p }) => {
  const s = srcOf(p.sid); const prev = s.status;
  s.status = "checking"; s.checking_text = s.provider === "slack" ? "Checking for new messages…" : s.provider === "notes" ? "Re-reading notes…" : "Checking for new emails…";
  setTimeout(() => { s.status = prev === "syncing" ? "syncing" : "synced"; delete s.checking_text; s.last_sync_at = new Date().toISOString(); s.activity.unshift({ at: s.last_sync_at, text: "Checked for new messages → nothing new" }); }, 2800);
  return s;
});
on("POST", "/api/v2/w/:wid/sources/:sid/pause", ({ p }) => { const s = srcOf(p.sid); s.status = "paused"; s.paused_at = new Date().toISOString(); s.paused_by = "you"; s.activity.unshift({ at: s.paused_at, text: "Syncing paused by Maya" }); return s; });
on("POST", "/api/v2/w/:wid/sources/:sid/resume", ({ p }) => {
  const s = srcOf(p.sid); s.status = "catching_up"; s.catching_up = { since: s.paused_at || d(-1), total: 6, done: 0 }; delete s.paused_at;
  const iv = setInterval(() => { s.catching_up.done += 1; if (s.catching_up.done >= s.catching_up.total) { clearInterval(iv); s.status = "synced"; delete s.catching_up; s.last_sync_at = new Date().toISOString(); } }, 700);
  return s;
});
on("POST", "/api/v2/w/:wid/sources/:sid/reconnect", ({ p }) => { const s = srcOf(p.sid); return { url: `/w/${p.wid}/sources/${s.id}?oauth=1` }; });
on("POST", "/api/v2/w/:wid/sources/:sid/reconnected", ({ p }) => {
  const s = srcOf(p.sid); const since = s.disconnected_at || d(-1, "08:02");
  Object.assign(s, { status: "catching_up", health: "ok", error: null, catching_up: { since, total: 18, done: 6 }, reconnected_at: new Date().toISOString() });
  delete s.disconnected_at;
  S.attention = S.attention.filter((a) => a.action?.target !== s.id);
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "source_reconnected", title: `${s.label} reconnected`, actor: { provider: s.provider, label: "Maya Rao" }, meta: "Catching up on 18 emails", system: true, source: s.provider });
  const iv = setInterval(() => { s.catching_up.done += 3; if (s.catching_up.done >= s.catching_up.total) { clearInterval(iv); s.status = "synced"; delete s.catching_up; s.last_sync_at = new Date().toISOString(); } }, 1500);
  return s;
});
on("POST", "/api/v2/w/:wid/sources/:sid/disconnect", ({ p, body }) => {
  const s = srcOf(p.sid);
  const keep = body.keep_memory !== false;
  const before = JSON.parse(JSON.stringify({ s, memory: S.memory }));
  Object.assign(s, { status: "disconnected", disconnected_at: new Date().toISOString(), kept_memory: keep });
  if (!keep) S.memory = S.memory.filter((m) => !(m.evidence || []).length || !(m.evidence || []).every((e) => e.source_id === s.id));
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "source_disconnected", title: `${s.label} disconnected`, actor: { provider: s.provider, label: "Maya Rao" }, meta: keep ? "Learned memory kept" : "Memory learned only from this source removed", system: true });
  undoStack[`disc_${s.id}`] = before;
  return { ...s, kept: keep ? (s.learned?.total || 0) : 0, removed: keep ? 0 : (s.provider === "gmail" ? 14 : onlyFrom(s.id).length) };
});
on("POST", "/api/v2/w/:wid/sources/:sid/undo-disconnect", ({ p }) => {
  const snap = undoStack[`disc_${p.sid}`]; if (!snap) throw new HttpError(409, "Nothing to undo.");
  const i = S.sources.findIndex((x) => x.id === p.sid); S.sources[i] = snap.s; S.memory = snap.memory; delete undoStack[`disc_${p.sid}`]; return S.sources[i];
});
on("GET", "/api/v2/w/:wid/sources/:sid/candidates", ({ p }) => {
  const s = srcOf(p.sid);
  if (s.provider === "slack") return { kind: "channels", account: "Northlight Studio", items: [
    { id: "C1", name: "#acme-redesign", meta: "6 members · active today", badge: "Mentions Acme", connected: true },
    ...s.candidates.map((c) => ({ id: c.id, name: c.name, meta: c.meta || `${c.members} members${c.active ? ` · active ${c.active}` : ""}`, badge: c.mentions ? "Mentions Acme" : null, suggested: !!c.mentions })),
  ] };
  return { kind: "threads", account: s.account, suggest_label: "Mention Acme Finance", items: s.candidates.map((c) => ({ id: c.id, name: c.subject, meta: `${c.from} · ${c.messages} msg${c.messages === 1 ? "" : "s"} · ${new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, messages: c.messages, suggested: !!c.suggested })) };
});
on("POST", "/api/v2/w/:wid/sources/:sid/threads", ({ p, body }) => {
  const s = srcOf(p.sid); const ids = new Set(body.ids || []);
  const key = s.threads ? "threads" : "channels";
  const pick = s.candidates.filter((c) => ids.has(c.id));
  pick.forEach((c) => s[key].push({ id: c.id, subject: c.subject, name: c.name, from: c.from, messages: c.messages, members: c.members, memories: 0, reading: true }));
  s.candidates = s.candidates.filter((c) => !ids.has(c.id));
  setTimeout(() => s[key].forEach((t) => { if (t.reading) { t.reading = false; t.memories = 2; } }), 4500);
  return s;
});
on("DELETE", "/api/v2/w/:wid/sources/:sid/threads/:tid", ({ p, q }) => {
  const s = srcOf(p.sid); const key = s.threads ? "threads" : "channels";
  const t = s[key].find((x) => x.id === p.tid); s[key] = s[key].filter((x) => x.id !== p.tid);
  if (t) s.candidates.unshift({ ...t, at: new Date().toISOString() });
  S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "source_scope", title: `Stopped reading “${t?.subject || t?.name}”`, actor: { provider: s.provider, label: "Maya Rao" }, meta: q.keep === "0" ? "2 memories removed" : "Memories kept, marked “source removed”", system: true });
  return s;
});
on("POST", "/api/v2/w/:wid/sources/connect", ({ body }) => ({ url: `/oauth-mock?provider=${body.provider}` }));
on("GET", "/api/v2/w/:wid/sources/candidates/:provider", ({ p }) => {
  if (p.provider === "slack") {
    const s = S.sources.find((x) => x.provider === "slack");
    return { kind: "channels", account: "Northlight Studio", items: [{ id: "C1", name: "#acme-redesign", meta: "6 members · active today", badge: "Mentions Acme", connected: !!s?.channels?.find((c) => c.id === "C1"), suggested: true }, ...(s?.candidates || []).map((c) => ({ id: c.id, name: c.name, meta: c.meta || `${c.members} members`, badge: c.mentions ? "Mentions Acme" : null, suggested: !!c.mentions }))] };
  }
  const g = S.sources.find((x) => x.provider === "gmail");
  return { kind: "threads", account: "maya@northlight.studio", items: (g?.candidates || []).map((c) => ({ id: c.id, name: c.subject, meta: `${c.from} · ${c.messages} msgs`, suggested: !!c.suggested })) };
});
on("POST", "/api/v2/w/:wid/sources/add", ({ body }) => {
  const prov = body.provider;
  let s = S.sources.find((x) => x.provider === prov);
  if (prov === "slack" && s) {
    (body.ids || []).forEach((id) => { if (id === "C1" || s.channels.find((c) => c.id === id)) return; const c = s.candidates.find((x) => x.id === id); if (c) { s.channels.push({ id: c.id, name: c.name, members: c.members, messages: c.messages || 0, memories: 0, reading: true }); s.candidates = s.candidates.filter((x) => x.id !== id); } });
    s.status = "syncing"; s.progress = { done: 0, total: 420 };
    const iv = setInterval(() => { s.progress.done = Math.min(s.progress.total, s.progress.done + 70); if (s.progress.done >= s.progress.total) { clearInterval(iv); s.status = "synced"; delete s.progress; s.channels.forEach((c) => { c.reading = false; }); } }, 900);
    return { ok: true, source_id: s.id, added: (body.ids || []).length };
  }
  return { ok: true, source_id: s?.id || null, oauth: !s };
});
on("POST", "/api/v2/w/:wid/notes", ({ p, body }) => {
  guardWrite(ws(p.wid));
  if (!body.text || body.text.trim().length < 20) throw new HttpError(400, "Paste a bit more — Bracket needs a few sentences to find anything.");
  let notesSrc = S.sources.find((s) => s.provider === "notes");
  if (!notesSrc) { notesSrc = { id: "s_notes", provider: "notes", label: "Notes", account: "Added in Bracket", status: "synced", last_sync_at: new Date().toISOString(), notes: [], activity: [], permissions: { read: true, send: false }, learned: { total: 0, by: {} }, connected_at: new Date().toISOString(), connected_by: "Maya Rao" }; S.sources.push(notesSrc); }
  const at = new Date().toISOString();
  const title = body.title || "Untitled note";
  const n = { id: uid("n"), title, at, by: "Maya Rao", memories: 3, body: body.text, attendees: (body.people || []).join(", ") };
  notesSrc.notes.unshift(n); notesSrc.last_sync_at = at;
  const nothing = /nothing|same as before/i.test(body.text);
  if (nothing) { n.memories = 0; notesSrc.activity.unshift({ at, text: `Note added: ${title} → nothing new` }); return { note: n, found: 0, needs_review: 0, nothing_new: true }; }
  const rid = uid("r");
  S.reviews.push({ id: rid, kind: "scope_change", status: "pending", label: "From a note", title: `${title}: tablet is needed for the board demo`, detected: { count: 1, unit: "note", at },
    interpretation: "Sarah needs tablet for the board demo on Oct 28 and agreed tablet can ship one week after launch. That changes the tablet date.",
    trigger: { provider: "notes", source_id: "s_notes", thread_id: n.id, from: "Maya Rao", to: "Notes", at, subject: title, body: body.text.split("\n").filter(Boolean).map((t, i) => (i === 0 ? { text: t, tags: ["Commitments"] } : { text: t })) },
    compared: [{ memory_id: "co3", text: "Launch two weeks after kickoff — Oct 17.", chip: { provider: "notes", label: "Kickoff call · Oct 3" } }],
    proposals: [{ id: "p1", category: "commitment", op: "modify", target: "co3", before: "Launch two weeks after kickoff — Oct 17.", after: "Tablet ships one week after launch — before the Oct 28 board demo.", confidence: "medium", rationale: "Agreed on the call, per your note." }] });
  [{ category: "requirement", title: "Tablet must be ready for the board demo on Oct 28" }, { category: "commitment", title: "Maya will send a revised timeline by Thursday." }].forEach((x) => S.memory.unshift({ id: uid("m"), ...x, status: "current", confidence: "high", created_at: at, changed_at: at, history: [{ at, text: `Added from note “${title}”` }], evidence: [{ id: uid("e"), provider: "notes", author: "Maya Rao", where: title, at, quote: x.title, source_id: "s_notes", ref_id: n.id }], related: [] }));
  notesSrc.activity.unshift({ at, text: `Note added: ${title} → 3 memories, 1 change to review` });
  S.events.unshift({ id: uid("ev"), short: `Note added: ${title}`, icon: "added", at, kind: "note_added", title: `Note added — ${title}`, actor: { provider: "notes", label: "Maya Rao" }, meta: "3 memories · 1 change to review", source: "notes", memory: true });
  return { note: n, found: 3, needs_review: 1, review_id: rid };
});

/* files */
on("GET", "/api/v2/w/:wid/files", ({ p }) => ({ files: dataFor(p.wid).files || [] }));
on("GET", "/api/v2/w/:wid/files/:fid", ({ p }) => {
  const f = S.files.find((x) => x.id === p.fid); if (!f) throw new HttpError(404, "File not found");
  const n = f.contributed?.memories || 0;
  const sample = [
    { category: "Scope", text: "Desktop and mobile are included", id: "sc1" },
    { category: "Deliverables", text: "Homepage design", id: "dl2" },
    { category: "Commitments", text: "Launch two weeks after kickoff", id: "co3" },
    { category: "People", text: "James Park approved the proposal", id: "pm_pe2" },
    { category: "Scope", text: "Marketing homepage plus four inner pages", id: "sc2" },
    { category: "Scope", text: "Two rounds of revisions per page", id: "sc6" },
  ].slice(0, n);
  return { ...f, memories: sample, impact: { total: n, supported_elsewhere: Math.max(0, n - 2), only_here: Math.min(2, n) } };
});
on("POST", "/api/v2/w/:wid/files", ({ p, body }) => {
  guardWrite(ws(p.wid));
  const name = body.name || "Untitled.pdf"; const ext = name.split(".").pop().toLowerCase();
  const size = body.size || 1.2e6;
  let status = "reading"; let reason = null;
  if (["mov", "mp4", "avi", "zip", "exe"].includes(ext)) { status = "not_supported"; reason = ["zip", "exe"].includes(ext) ? "Archives aren't supported — upload the files inside" : "Video isn't supported — add a transcript"; }
  else if (size > 50e6) { status = "too_large"; reason = "Larger than 50 MB — split the file or upload the relevant pages"; }
  else if (/locked|protected/i.test(name)) { status = "failed"; reason = "Password-protected — upload an unlocked copy"; }
  const pages = body.pages || Math.max(2, Math.round(size / 300e3));
  const f = { id: uid("f"), name, type: ext, size, pages, added_at: new Date().toISOString(), added_by: "Maya", status, reason, progress: status === "reading" ? { done: 0, total: pages } : undefined };
  S.files.unshift(f);
  if (status === "reading") {
    let step = 0; const iv = setInterval(() => {
      step += Math.max(1, Math.round(pages / 5)); f.progress = { done: Math.min(step, pages), total: pages };
      if (step >= pages) { clearInterval(iv); delete f.progress; if (/empty|blank|same/i.test(name)) { f.status = "nothing_new"; f.reason = "Nothing new found — everything in it already matches memory"; } else { f.status = "in_memory"; f.contributed = { memories: 2, categories: ["Scope"], proposed: 2 }; } }
    }, 600);
  }
  S.events.unshift({ id: uid("ev"), at: f.added_at, kind: "file_added", title: `File uploaded — ${name}`, actor: { provider: "notes", label: "Maya Rao" }, meta: status === "reading" ? "Reading…" : reason, source: "notes" });
  return f;
});
on("POST", "/api/v2/w/:wid/files/:fid/replace", ({ p, body }) => { const f = S.files.find((x) => x.id === p.fid); Object.assign(f, { name: body.name || f.name, status: "reading", progress: { done: 0, total: f.pages || 4 }, reason: null }); setTimeout(() => { f.status = "in_memory"; delete f.progress; }, 3000); return f; });
on("DELETE", "/api/v2/w/:wid/files/:fid", ({ p, q }) => { guardWrite(ws(p.wid)); const f = S.files.find((x) => x.id === p.fid); S.files = S.files.filter((x) => x.id !== p.fid); S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "file_deleted", title: `File deleted — ${f?.name}`, actor: { provider: "notes", label: "Maya Rao" }, meta: q.keep === "0" ? "2 memories removed · restorable for 30 days" : "Memories kept, marked “source removed”", memory: q.keep === "0" }); return { ok: true, kept_memory: q.keep !== "0" }; });

/* onboarding */
const onb = {}; // wid → { connected: {gmail, slack}, started_at, threads, channels }
on("POST", "/api/v2/w/:wid/onboarding/connect", ({ p, body }) => {
  const o = (onb[p.wid] = onb[p.wid] || { connected: {} });
  if (body.cancelled) { o.connected[body.provider] = "cancelled"; return o; }
  o.connected[body.provider] = body.provider === "gmail" ? "maya@northlight.studio" : body.provider === "slack" ? "Northlight Studio" : true;
  return o;
});
on("GET", "/api/v2/w/:wid/onboarding", ({ p }) => {
  const o = onb[p.wid] || { connected: {} };
  const w = ws(p.wid);
  return {
    workspace: wsSummary(w), connected: o.connected,
    threads: [
      { id: "t1", name: "Re: Homepage direction + next steps", from: "sarah.chen@acmefinance.com", messages: 14, at: mins(18), mentions: true, selected: true },
      { id: "t2", name: "Kickoff recap — Acme Finance", from: "sarah.chen@acmefinance.com", messages: 6, at: d(-4), mentions: true, selected: true },
      { id: "t3", name: "Proposal — Acme Finance website", from: "james.park@acmefinance.com", messages: 9, at: d(-12), mentions: true, selected: true },
      { id: "t4", name: "Brand assets", from: "sarah.chen@acmefinance.com", messages: 3, at: d(-8), mentions: true, selected: false },
      { id: "t9", name: "Team offsite planning", from: "team@northlight.studio", messages: 22, at: d(-13), mentions: false, selected: false },
    ],
    channels: o.connected.slack && o.connected.slack !== "cancelled" ? [{ id: "C1", name: "#acme-redesign", messages: 3880, selected: true }] : [],
  };
});
on("POST", "/api/v2/w/:wid/onboarding/start", ({ p, body }) => {
  const o = (onb[p.wid] = onb[p.wid] || { connected: {} });
  Object.assign(o, { started_at: Date.now(), threads: body.thread_ids || [], channels: body.channel_ids || [] });
  return { ok: true };
});
on("GET", "/api/v2/w/:wid/onboarding/progress", ({ p }) => {
  const o = onb[p.wid] || { started_at: Date.now(), threads: ["t1", "t2", "t3"], channels: ["C1"] };
  const t = Math.min(1, (Date.now() - (o.started_at || Date.now())) / 9000);
  const found = [
    { category: "Scope", text: "Desktop and mobile are included", provider: "gmail" },
    { category: "Decisions", text: "Homepage direction changed to editorial", provider: "gmail" },
    { category: "Requirements", text: "Performance and SEO are priorities", provider: "notes" },
    { category: "Commitments", text: "Mobile screens promised by Friday", provider: "slack" },
    { category: "Needs attention", text: "Tablet layouts requested — may change scope", provider: "gmail", attention: true },
  ].slice(0, Math.max(1, Math.ceil(t * 5)));
  const slackDone = Math.round(1204 + (3880 - 1204) * t);
  return {
    done: t >= 1,
    gmail: { label: `${o.threads?.length || 3} threads · 29 messages`, done: true, pct: 1 },
    slack: o.channels?.length ? { label: `#acme-redesign · ${slackDone.toLocaleString("en-US")} of 3,880`, done: t >= 1, pct: slackDone / 3880, eta: t >= 1 ? null : `About ${Math.max(1, Math.round(6 * (1 - t)))} min left` } : null,
    found, found_count: Math.round(12 + 27 * t),
  };
});
on("POST", "/api/v2/w/:wid/onboarding/finish", ({ p }) => {
  // The mock fills the new workspace with the Figma story so every screen works.
  const w = ws(p.wid);
  if (!isPrimary(p.wid)) { S.primaryIds.add(p.wid); Object.assign(w, { summary: S.workspaces[0].summary, memory_updated_at: new Date().toISOString() }); }
  return { ok: true, workspace: wsSummary(w), counts: { scope: 6, decision: 9, deliverable: 4, requirement: 7, commitment: 5, person: 8 }, read: "3 threads, 3,880 Slack messages and 2 notes", attention: { title: "Sarah asked to add tablet layouts while keeping the two-week timeline", review_id: "r1" } };
});

/* members */
on("GET", "/api/v2/w/:wid/members", () => ({ members: S.members }));
on("POST", "/api/v2/w/:wid/members/invite", ({ p, body }) => {
  const w = ws(p.wid); if (w.role !== "owner") throw new HttpError(403, "Only owners can invite people.");
  const emails = (body.emails || []).filter(Boolean);
  if (!emails.length) throw new HttpError(400, "Add at least one email address.");
  const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)); if (bad) throw new HttpError(400, `“${bad}” isn’t a valid email address.`);
  emails.forEach((e) => S.members.push({ id: uid("u"), name: null, email: e, role: body.role || "editor", status: "pending", invited_at: new Date().toISOString() }));
  return { ok: true, invited: emails.length, outside_domain: emails.filter((e) => !e.endsWith("@northlight.studio")) };
});
on("PATCH", "/api/v2/w/:wid/members/:mid", ({ p, body }) => { const m = S.members.find((x) => x.id === p.mid); Object.assign(m, body); return m; });
on("DELETE", "/api/v2/w/:wid/members/:mid", ({ p, body }) => { const m = S.members.find((x) => x.id === p.mid); S.members = S.members.filter((x) => x.id !== p.mid); S.events.unshift({ id: uid("ev"), at: new Date().toISOString(), kind: "member_removed", title: `${m?.name || m?.email} removed from the workspace`, actor: { provider: "manual", label: "Maya Rao" }, meta: body?.reassign_to ? `Open commitments reassigned to ${body.reassign_to}` : "", system: true }); return { ok: true }; });
on("GET", "/api/v2/w/:wid/members/:mid/commitments", ({ p }) => { const m = S.members.find((x) => x.id === p.mid); const name = m?.name; return { items: name === "Lena Torres" ? [{ id: "lx1", title: "Homepage copy draft by Oct 12" }] : [] }; });
on("POST", "/api/v2/w/:wid/members/:mid/resend", () => ({ ok: true }));

/* updates (bell) */
on("GET", "/api/v2/updates", () => ({ items: S.updates, unread: S.updates.filter((u) => !u.read).length }));
on("POST", "/api/v2/contact", ({ body }) => {
  if (!body.name || !body.email || !body.message) throw new HttpError(422, "Name, email and message are required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) throw new HttpError(422, "Enter a valid email address.", { field: "email" });
  return { ok: true };
});
on("POST", "/api/v2/updates/read", ({ body }) => { S.updates.forEach((u) => { if (!body.ids || body.ids.includes(u.id)) u.read = true; }); return { ok: true }; });

/* search (⌘K) */
on("GET", "/api/v2/w/:wid/search", ({ p, q }) => {
  const s = (q.q || "").toLowerCase(); if (!s) return { memory: [], people: [], conversations: [] };
  return {
    memory: current().filter((m) => m.title.toLowerCase().includes(s)).slice(0, 5).map((m) => ({ id: m.id, category: m.category, title: m.short || m.title })),
    people: S.people.filter((x) => x.name.toLowerCase().includes(s)).map((x) => ({ id: x.id, name: x.name, role: x.role })),
    conversations: S.threads.filter((t) => t.title.toLowerCase().includes(s) || (t.who || "").toLowerCase().includes(s)).slice(0, 4).map((t) => ({ id: t.id, provider: t.provider, title: t.title, who: t.who })),
  };
});

/* v1 compat used by legacy pages + connect flow */
on("GET", "/api/projects", () => S.workspaces.map((w) => ({ id: w.id, name: w.name, client_name: w.client_name, archived: w.status === "archived", created_at: w.created_at, updated_at: w.memory_updated_at })));
on("GET", "/api/project-quota", () => ({ plan: S.billing.plan, limit: S.billing.workspaces.limit, used: S.billing.workspaces.used, archived: 1, can_create: S.billing.workspaces.used < S.billing.workspaces.limit }));
on("GET", "/api/payments/billing", () => S.billing);
on("GET", "/api/public/ph-launch", () => ({ enabled: false }));
on("POST", "/api/public/track/session", () => ({ ok: true }));
on("POST", "/api/public/track/click", () => ({ ok: true }));
on("GET", "/api/push/vapid-public-key", () => ({ key: null }));

/* ───────────────────────── server ───────────────────────── */
const MIME = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".txt": "text/plain", ".woff2": "font/woff2", ".map": "application/json" };
const send = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "x-bracket-mock": "1" }); res.end(obj === undefined ? "null" : JSON.stringify(obj)); };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      const q = Object.fromEntries(url.searchParams);
      if (sessionExpired && !url.pathname.startsWith("/api/__mock") && !url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/public")) {
        return send(res, 401, { detail: "Your session expired. Sign in again to continue.", code: "session_expired" });
      }
      if (!loggedIn && url.pathname.startsWith("/api/v2/") && !url.pathname.startsWith("/api/v2/auth") && !url.pathname.startsWith("/api/v2/invites") && !url.pathname.startsWith("/api/v2/contact")) {
        return send(res, 401, { detail: "Not signed in" });
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.rx);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        try {
          const out = r.fn({ p, q, body });
          if (out && out.__redirect) { res.writeHead(302, { Location: out.__redirect }); return res.end(); }
          const delay = /\/ask$|\/draft$|\/accept$/.test(url.pathname) ? 650 : 90;
          return setTimeout(() => send(res, 200, out), delay);
        } catch (e) {
          if (e instanceof HttpError) return setTimeout(() => send(res, e.status, { detail: e.message, ...(e.extra || {}) }), 120);
          console.error(e);
          return send(res, 500, { detail: String(e.message || e) });
        }
      }
      return send(res, 404, { detail: `mock: no route for ${req.method} ${url.pathname}` });
    });
    return;
  }
  let file = path.join(BUILD, decodeURIComponent(url.pathname));
  if (!file.startsWith(BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(BUILD, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("Run `npm run build` in frontend/ first, or use `npm start` (dev server proxies /api here)."); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Bracket mock API on http://localhost:${PORT}`));
